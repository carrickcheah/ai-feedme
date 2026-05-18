/**
 * Customer-facing Agent — entry point for the FeedMe chat UI.
 *
 * Thin wrapper around agent-base. Publishes order.created via Kafka
 * (with in-process fallback) after a successful pos__create_order call.
 */
import { ulid } from "ulid";
import { runAgent } from "./agent-base";
import { type OrderCreatedEvent } from "./kitchen";
import { publishOrderCreated } from "../events";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ChatMessage } from "../brain";
import { env } from "../config/env";
import { logger } from "../lib/logger";
import { loadPrompt } from "./prompts/loader";

export interface ChatRequest {
  message: string;
  customer_id?: string | null;
  session_id?: string | null;
  channel: "kiosk" | "mobile" | "web";
}

export interface ChatResponse {
  output: string;
  session_id: string;
  tools_called: string[];
  tokens: { input: number; output: number; reasoning: number };
  cost_usd: number;
  duration_ms: number;
  success: boolean;
  error?: string;
}

const sessions = new Map<string, ChatMessage[]>();
const MAX_HISTORY = 20;

const PROFILES_DIR = join(dirname(fileURLToPath(import.meta.url)), "prompts", "customer-profiles");
const profileCache = new Map<string, string | null>();

/**
 * Load a hardcoded customer profile (.md) by customer_id. Returns null if
 * no profile exists for that id — caller should treat the customer as
 * anonymous in that case.
 */
function loadCustomerProfile(customer_id: string): string | null {
  if (profileCache.has(customer_id)) return profileCache.get(customer_id) ?? null;
  // customer_id is a controlled string from our own POS schema (e.g. cust_sarah_001).
  // Defensive sanitize anyway so a bad id can't traverse out of PROFILES_DIR.
  if (!/^[a-z0-9_]+$/i.test(customer_id)) {
    profileCache.set(customer_id, null);
    return null;
  }
  try {
    const text = readFileSync(join(PROFILES_DIR, `${customer_id}.md`), "utf-8").trim();
    profileCache.set(customer_id, text);
    return text;
  } catch {
    profileCache.set(customer_id, null);
    return null;
  }
}

function buildSystemPrompt(channel: string, session_id: string, customer_id: string | null): string {
  return loadPrompt("customer-facing", {
    restaurant_name: env.RESTAURANT_NAME,
    channel,
    session_id,
    customer_id: customer_id ?? "null",
  });
}

/**
 * Parse the agent's tool call trace to detect a successful pos__create_order
 * and extract the (order_id, items) tuple. Used to trigger Kitchen in-process.
 */
function extractCreatedOrder(toolsCalled: string[]): boolean {
  return toolsCalled.includes("pos__create_order");
}

/**
 * Read the most-recent order for this session — used to build the order.created
 * event payload. Queries pos.db directly rather than round-tripping through the
 * POS MCP, since we have no order_id at this point.
 */
async function fetchLatestOrderForSession(session_id: string): Promise<OrderCreatedEvent | null> {
  try {
    const { Database } = await import("bun:sqlite");
    const db = new Database("./data/pos.db", { readonly: true });
    const order = db
      .prepare(`SELECT order_id, customer_id, channel FROM "order" WHERE session_id = ? ORDER BY created_at DESC LIMIT 1`)
      .get(session_id) as { order_id: string; customer_id: string | null; channel: string } | undefined;
    if (!order) {
      db.close();
      return null;
    }
    const lines = db
      .prepare(`SELECT menu_item_sku as sku, qty FROM order_line WHERE order_id = ?`)
      .all(order.order_id) as Array<{ sku: string; qty: number }>;
    db.close();
    return {
      order_id: order.order_id,
      customer_id: order.customer_id,
      session_id,
      channel: order.channel as "kiosk" | "mobile" | "web",
      items: lines.map((l) => ({ sku: l.sku, qty: l.qty })),
    };
  } catch (err) {
    logger.warn({ err: String(err), session_id }, "[AGENT:customer-facing] failed to fetch order for kitchen trigger");
    return null;
  }
}

/**
 * Streaming variant of processChatMessage. Same logic, but pipes each content
 * chunk through `onContentChunk` as the LLM emits it. The returned ChatResponse
 * still carries the full assembled output + tools_called + metadata at the end.
 */
export async function processChatMessageStreaming(
  req: ChatRequest,
  onContentChunk: (delta: string) => void,
): Promise<ChatResponse> {
  return processChatMessageInner(req, onContentChunk);
}

export async function processChatMessage(req: ChatRequest): Promise<ChatResponse> {
  return processChatMessageInner(req);
}

async function processChatMessageInner(
  req: ChatRequest,
  onContentChunk?: (delta: string) => void,
): Promise<ChatResponse> {
  const session_id = req.session_id ?? `sess_${ulid()}`;
  const history = sessions.get(session_id) ?? [];

  // ── Customer profile: load directly from a hardcoded .md per customer_id ──
  // For the demo we ship known VIP profiles as plain markdown under
  // src/agents/prompts/customer-profiles/<customer_id>.md so the first turn
  // is instant. The MemGC sidecar is left in place as the architectural
  // story (and would be the path for unknown customers in production), but
  // the demo's headline path does not pay its ~50s PRISM cost.
  let memoryContext: string | undefined;
  if (req.customer_id && history.length === 0) {
    memoryContext = loadCustomerProfile(req.customer_id) ?? undefined;
    if (memoryContext) {
      logger.info({ customer_id: req.customer_id }, "[AGENT:customer-facing] profile loaded (hardcoded)");
    }
  }

  const result = await runAgent({
    agent: "customer-facing",
    systemPrompt: buildSystemPrompt(req.channel, session_id, req.customer_id ?? null),
    userMessage: req.message,
    allowedMcpServers: ["pos", "payment"],
    sessionId: session_id,
    userId: req.customer_id ?? null,
    history,
    maxCompletionTokens: 1024,
    memoryContext,
    onContentChunk,
  });

  // Update session history (drop tool-churn turns; keep only user + final assistant)
  if (result.success) {
    const newHistory: ChatMessage[] = [
      ...history,
      { role: "user" as const, content: req.message },
      { role: "assistant" as const, content: result.output },
    ].slice(-MAX_HISTORY);
    sessions.set(session_id, newHistory);
  }

  // ── Multi-agent trigger: if an order was created, publish order.created ──
  // Kafka if available, in-process fallback if not — agent always wakes either way.
  if (result.success && extractCreatedOrder(result.tools_called)) {
    fetchLatestOrderForSession(session_id)
      .then(async (event) => {
        if (!event) {
          logger.warn({ session_id }, "[AGENT:customer-facing] order created but couldn't fetch details to publish");
          return;
        }
        const r = await publishOrderCreated(event);
        logger.info(
          { session_id, order_id: event.order_id, via_kafka: r.via_kafka, event_id: r.event_id },
          "[AGENT:customer-facing] order.created event dispatched",
        );
      })
      .catch((err) => logger.error({ err: String(err) }, "[AGENT:customer-facing] order.created publish failed"));
  }

  return result;
}

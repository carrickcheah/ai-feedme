/**
 * Customer-facing Agent — entry point for the FeedMe chat UI.
 *
 * Phase 2 Stage B: thin wrapper around agent-base. Adds:
 *  - In-process trigger to Kitchen Agent after a create_order tool call,
 *    so the multi-agent dance works end-to-end without Kafka.
 *  - Session history persistence in-memory (Phase 1+ moves to Redis).
 *
 * Phase 2 Stage C swaps the in-process trigger for a Kafka order.created publish.
 */
import { ulid } from "ulid";
import { runAgent } from "./agent-base";
import { type OrderCreatedEvent } from "./kitchen";
import { publishOrderCreated } from "../events";
import { memgcAnswer } from "../memgc-client";
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

// In-memory session store (Phase 3 moves to Redis).
const sessions = new Map<string, ChatMessage[]>();
const MAX_HISTORY = 20;

function buildSystemPrompt(channel: string, session_id: string): string {
  return loadPrompt("customer-facing", {
    restaurant_name: env.RESTAURANT_NAME,
    channel,
    session_id,
  });
}

/**
 * Parse the agent's tool call trace to detect a successful pos__create_order
 * and extract the (order_id, items) tuple. Used to trigger Kitchen in-process.
 */
function extractCreatedOrder(toolsCalled: string[]): boolean {
  // Phase 2 Stage B: we only flag that an order was created. The actual order details
  // are pulled separately from pos.db (single tenant, single restaurant).
  return toolsCalled.includes("pos__create_order");
}

/**
 * Read the most-recent pending/confirmed order for this session — used to feed Kitchen.
 * Phase 2 Stage C will replace this with a Kafka envelope carrying the order data.
 */
async function fetchLatestOrderForSession(session_id: string): Promise<OrderCreatedEvent | null> {
  // We use the POS MCP's get_order over HTTP — but we need an order_id first.
  // Phase 2 Stage B simplification: query pos.db directly via the supplier-style read pattern.
  // We'll use a tiny SQL helper inline for now.
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

  // ── MemGC: fetch customer profile if customer_id present (cached) ──
  let memoryContext: string | undefined;
  if (req.customer_id && history.length === 0) {
    // Only on first turn — cached subsequent answers reuse it for free
    const t0 = Date.now();
    const profile = await memgcAnswer(
      `What do you know about customer ${req.customer_id}? Summarize their preferences, allergies, usual orders, loyalty tier.`,
    );
    if (profile.text && profile.memories.length > 0) {
      memoryContext = profile.text;
      logger.info(
        {
          customer_id: req.customer_id,
          memories: profile.memories.length,
          cached: profile.cached,
          duration_ms: Date.now() - t0,
        },
        "[AGENT:customer-facing] memory loaded",
      );
    } else {
      logger.debug({ customer_id: req.customer_id }, "[AGENT:customer-facing] no memory for customer");
    }
  }

  const result = await runAgent({
    agent: "customer-facing",
    systemPrompt: buildSystemPrompt(req.channel, session_id),
    userMessage: req.message,
    allowedMcpServers: ["pos", "payment"],
    sessionId: session_id,
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

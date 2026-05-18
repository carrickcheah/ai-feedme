/**
 * Kitchen Agent — schedules tickets and decrements ingredient stock.
 *
 * Event-driven (woken by order.created via Kafka, or in-process fallback).
 * A synthetic user message describes the new order; the agent decides which
 * tickets to fire and which ingredients were consumed.
 */
import { Database } from "bun:sqlite";
import { runAgent } from "./agent-base";
import { env } from "../config/env";
import { logger } from "../lib/logger";
import { publishIngredientConsumed } from "../events/publisher";
import { loadPrompt } from "./prompts/loader";

export interface OrderCreatedEvent {
  order_id: string;
  customer_id: string | null;
  session_id: string | null;
  channel: "kiosk" | "mobile" | "web";
  items: Array<{ sku: string; qty: number; modifiers?: Record<string, unknown> }>;
}

function buildKitchenPrompt(): string {
  return loadPrompt("kitchen", { restaurant_name: env.RESTAURANT_NAME });
}

function buildOrderEventMessage(event: OrderCreatedEvent): string {
  const itemsLine = event.items.map((i) => `${i.qty}× ${i.sku}`).join(", ");
  return `Order ${event.order_id} just came in via ${event.channel}${event.customer_id ? ` from customer ${event.customer_id}` : " (anonymous)"}.

Items:
${event.items.map((i, idx) => `  ${idx + 1}. sku="${i.sku}" qty=${i.qty}${i.modifiers ? ` modifiers=${JSON.stringify(i.modifiers)}` : ""}`).join("\n")}

Compact form for tool args: order_id="${event.order_id}", items=${JSON.stringify(event.items)}

Schedule: call kitchen-display__send_ticket with this order, then supplier__record_ingredient_consumption with the resulting ticket_id.

Summary: ${itemsLine}.`;
}

/**
 * Main handler — call this when an order.created event fires (in-process or via Kafka consumer).
 */
export async function handleOrderCreated(event: OrderCreatedEvent): Promise<void> {
  logger.info({ order_id: event.order_id, items: event.items.length, channel: event.channel }, "[AGENT:kitchen] order received");

  const result = await runAgent({
    agent: "kitchen",
    systemPrompt: buildKitchenPrompt(),
    userMessage: buildOrderEventMessage(event),
    allowedMcpServers: ["pos", "kitchen-display", "supplier"],
    sessionId: `sess_kitchen_${event.order_id}`,
    userId: event.customer_id ?? "system",
    maxCompletionTokens: 1024,
    maxAgentTurns: 5,
  });

  if (!result.success) {
    logger.error({ order_id: event.order_id, error: result.error }, "[AGENT:kitchen] failed");
    return;
  }
  logger.info(
    {
      order_id: event.order_id,
      tools: result.tools_called,
      tokens: result.tokens,
      cost_usd: result.cost_usd,
      duration_ms: result.duration_ms,
      output_preview: result.output.slice(0, 200),
    },
    "[AGENT:kitchen] done",
  );

  // After Kitchen finishes, publish one ingredient.consumed event per consumed row.
  // This is the bridge to the Inventory Agent + auto-86 chain.
  // We query supplier.db rather than parsing the agent's tool trace — simpler + reliable.
  try {
    const db = new Database("./data/supplier.db", { readonly: true });
    const rows = db
      .prepare(
        `SELECT ic.ingredient_id, ic.qty, i.stock_qty AS remaining_stock
         FROM ingredient_consumption ic
         LEFT JOIN ingredient i ON i.ingredient_id = ic.ingredient_id
         WHERE ic.order_id = ?
         ORDER BY ic.id DESC`,
      )
      .all(event.order_id) as Array<{ ingredient_id: string; qty: number; remaining_stock: number | null }>;
    db.close();

    if (!rows.length) {
      logger.warn({ order_id: event.order_id }, "[AGENT:kitchen] no consumption rows to publish");
      return;
    }

    // De-duplicate by ingredient_id (one event per unique ingredient for this order)
    const seen = new Set<string>();
    for (const r of rows) {
      if (seen.has(r.ingredient_id)) continue;
      seen.add(r.ingredient_id);
      await publishIngredientConsumed({
        order_id: event.order_id,
        ticket_id: null,
        ingredient_id: r.ingredient_id,
        qty: r.qty,
        remaining_stock: r.remaining_stock ?? 0,
      });
    }
    logger.info({ order_id: event.order_id, count: seen.size }, "[AGENT:kitchen] ingredient.consumed events dispatched");
  } catch (err) {
    logger.error(
      { order_id: event.order_id, err: err instanceof Error ? err.message : String(err) },
      "[AGENT:kitchen] failed to publish ingredient.consumed",
    );
  }
}

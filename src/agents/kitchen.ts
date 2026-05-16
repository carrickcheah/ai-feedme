/**
 * Kitchen Agent — schedules tickets and decrements ingredient stock.
 *
 * Phase 2 Stage B: triggered by in-process call from customer-facing.ts.
 * Phase 2 Stage C: triggered by Kafka order.created consumer.
 *
 * The agent is not chat-driven — it's event-driven. A synthetic user message
 * describes the new order; the agent reasons about which tickets to fire and
 * which ingredients were consumed.
 */
import { runAgent } from "./agent-base";
import { env } from "../config/env";
import { logger } from "../lib/logger";

export interface OrderCreatedEvent {
  order_id: string;
  customer_id: string | null;
  session_id: string | null;
  channel: "kiosk" | "mobile" | "web";
  items: Array<{ sku: string; qty: number; modifiers?: Record<string, unknown> }>;
}

function buildKitchenPrompt(): string {
  return `You are the kitchen agent for ${env.RESTAURANT_NAME}, an autonomous AI scheduler running behind the scenes (you do NOT chat with customers).

# Your job
- React to incoming "order.created" events
- For each event, call kitchen-display__send_ticket once to push tickets to the KDS, then
  call supplier__record_ingredient_consumption to decrement stock for the items that were just sent to cook.
- Skip any other tools unless you need to look up menu metadata.

# Rules
- Always call kitchen-display__send_ticket FIRST (with the order_id and all items), THEN
  call supplier__record_ingredient_consumption with the same order_id and the resulting ticket_id from the first call.
- For send_ticket: pass the items array as-is from the event. Priority defaults to 0 unless told otherwise.
- For record_ingredient_consumption: pass sku_consumption as [{sku, qty}, …] from the same items, plus the order_id and ticket_id.
- Be terse — your output is logs, not customer messages. One short status line per order is enough.
- NEVER call pos__create_order, payment__*, or kitchen-display__expedite unless asked.

# Tool use protocol
- Available tools are prefixed with "pos__" (read-only menu lookup), "kitchen-display__" (send_ticket / mark_ready / expedite / get_queue), and "supplier__" (get_ingredient_stock / record_ingredient_consumption / list_suppliers / get_lead_time / place_order).
- If supplier__record_ingredient_consumption returns low_stock_ingredients, log them but don't call place_order (Inventory Agent handles reorders in Phase 2 Stage C).`;
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
}

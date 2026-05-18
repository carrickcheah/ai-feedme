/**
 * Inventory Agent — reacts to ingredient.consumed events.
 *
 * Triggered by Kafka (or in-process fallback) when an ingredient was used.
 * Decides whether to reorder based on stock vs par. If stock drops below par,
 * also publishes stock.low (which the propagator uses to 86 menu items).
 */
import { Database } from "bun:sqlite";
import { runAgent } from "./agent-base";
import { env } from "../config/env";
import { logger } from "../lib/logger";
import { publishStockLow } from "../events/publisher";
import { loadPrompt } from "./prompts/loader";
import type { IngredientConsumedData } from "../events/types";

function buildInventoryPrompt(): string {
  return loadPrompt("inventory", { restaurant_name: env.RESTAURANT_NAME });
}

function buildEventMessage(event: IngredientConsumedData): string {
  return `Ingredient consumed event:
- ingredient_id: ${event.ingredient_id}
- qty consumed: ${event.qty}
- remaining_stock: ${event.remaining_stock}
- triggered by order: ${event.order_id}

Check whether ${event.ingredient_id} needs reordering. If remaining_stock <= par_qty, place a supplier order using the preferred supplier.`;
}

/**
 * Compute the list of menu_item SKUs that contain a given ingredient_id.
 * Used to populate stock.low's affected_skus.
 */
function findAffectedSkus(ingredient_id: string): string[] {
  const ingShort = ingredient_id.replace(/^ing_/, "");
  try {
    const db = new Database("./data/pos.db", { readonly: true });
    const rows = db
      .prepare(`SELECT sku FROM menu_item WHERE ingredient_ids_json LIKE ? AND is_available = 1`)
      .all(`%"${ingShort}"%`) as Array<{ sku: string }>;
    db.close();
    return rows.map((r) => r.sku);
  } catch (err) {
    logger.warn({ err: String(err), ingredient_id }, "[AGENT:inventory] findAffectedSkus failed");
    return [];
  }
}

/**
 * Snapshot the ingredient's current state from supplier.db.
 * Used to decide whether to publish stock.low after the agent's reorder decision.
 */
function snapshotIngredient(ingredient_id: string): { name: string; stock_qty: number; par_qty: number } | null {
  try {
    const db = new Database("./data/supplier.db", { readonly: true });
    const row = db
      .prepare(`SELECT name, stock_qty, par_qty FROM ingredient WHERE ingredient_id = ?`)
      .get(ingredient_id) as { name: string; stock_qty: number; par_qty: number } | undefined;
    db.close();
    return row ?? null;
  } catch (err) {
    logger.warn({ err: String(err), ingredient_id }, "[AGENT:inventory] snapshotIngredient failed");
    return null;
  }
}

export async function handleIngredientConsumed(event: IngredientConsumedData): Promise<void> {
  logger.info(
    { order_id: event.order_id, ingredient_id: event.ingredient_id, remaining: event.remaining_stock },
    "[AGENT:inventory] consumption event",
  );

  const result = await runAgent({
    agent: "inventory",
    systemPrompt: buildInventoryPrompt(),
    userMessage: buildEventMessage(event),
    allowedMcpServers: ["supplier"],
    sessionId: `sess_inventory_${event.order_id}_${event.ingredient_id}`,
    userId: "system",
    maxCompletionTokens: 512,
    maxAgentTurns: 3,
  });

  if (!result.success) {
    logger.error({ ingredient_id: event.ingredient_id, error: result.error }, "[AGENT:inventory] failed");
    return;
  }

  logger.info(
    {
      ingredient_id: event.ingredient_id,
      tools: result.tools_called,
      reordered: result.tools_called.includes("supplier__place_order"),
      duration_ms: result.duration_ms,
      cost_usd: result.cost_usd,
      output_preview: result.output.slice(0, 200),
    },
    "[AGENT:inventory] done",
  );

  // After agent decides, check current stock — if below par, publish stock.low so 86 propagates
  const snap = snapshotIngredient(event.ingredient_id);
  if (snap && snap.stock_qty < snap.par_qty) {
    const affected = findAffectedSkus(event.ingredient_id);
    if (affected.length > 0) {
      const publishResult = await publishStockLow({
        ingredient_id: event.ingredient_id,
        ingredient_name: snap.name,
        current_stock: snap.stock_qty,
        par_qty: snap.par_qty,
        affected_skus: affected,
        reorder_triggered: result.tools_called.includes("supplier__place_order"),
      });
      logger.info(
        {
          ingredient_id: event.ingredient_id,
          affected_skus: affected,
          via_kafka: publishResult.via_kafka,
        },
        "[AGENT:inventory] stock.low published",
      );
    }
  }
}

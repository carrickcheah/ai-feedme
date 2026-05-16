/**
 * stock.low propagator — flips menu_item.is_available = 0 for affected SKUs.
 *
 * This is the deterministic last leg of the v8 SVG event chain:
 *   ingredient.consumed → Inventory Agent → stock.low → THIS handler → pos.db
 *
 * No LLM needed — it's a pure database write keyed on the stock.low payload's
 * affected_skus array (which Inventory Agent computed via pos.db lookup).
 */
import { Database } from "bun:sqlite";
import { logger } from "../lib/logger";
import type { StockLowData } from "./types";

/**
 * Set menu_item.is_available = 0 for every SKU in the stock.low payload.
 * Idempotent — already-86'd items just get a no-op update.
 */
export async function handleStockLow(event: StockLowData): Promise<void> {
  if (!event.affected_skus.length) {
    logger.debug({ ingredient_id: event.ingredient_id }, "[86-PROPAGATOR] no affected SKUs, skipping");
    return;
  }
  let updatedCount = 0;
  try {
    const db = new Database("./data/pos.db");
    db.run("PRAGMA journal_mode = WAL");
    const stmt = db.prepare(`UPDATE menu_item SET is_available = 0, updated_at = datetime('now') WHERE sku = ?`);
    const tx = db.transaction(() => {
      for (const sku of event.affected_skus) {
        const res = stmt.run(sku);
        if (res.changes > 0) updatedCount++;
      }
    });
    tx();
    db.close();
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err), ingredient_id: event.ingredient_id },
      "[86-PROPAGATOR] write failed",
    );
    return;
  }

  logger.info(
    {
      ingredient_id: event.ingredient_id,
      ingredient_name: event.ingredient_name,
      stock: event.current_stock,
      par: event.par_qty,
      affected_skus: event.affected_skus,
      updated_count: updatedCount,
      reorder_triggered: event.reorder_triggered,
    },
    `[86-PROPAGATOR] 86'd ${updatedCount} menu item${updatedCount === 1 ? "" : "s"} due to low ${event.ingredient_name}`,
  );
}

/**
 * Supplier MCP — SQLite client. Opens pos.db read-only to translate sku → ingredient_ids.
 */
import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const DB_PATH = process.env.SUPPLIER_DB_PATH || "./data/supplier.db";
const POS_DB_PATH = process.env.POS_DB_PATH || "./data/pos.db";

let _db: Database | null = null;
let _posDb: Database | null = null;

export function getDb(): Database {
  if (_db) return _db;
  _db = new Database(DB_PATH, { create: true });
  _db.run("PRAGMA journal_mode = WAL");
  _db.run("PRAGMA synchronous = NORMAL");
  _db.run("PRAGMA foreign_keys = ON");
  const schema = readFileSync(join(import.meta.dir, "schema.sql"), "utf-8");
  _db.run(schema);
  return _db;
}

export function getPosReader(): Database {
  if (_posDb) return _posDb;
  _posDb = new Database(POS_DB_PATH, { readonly: true });
  return _posDb;
}

export function closeDb(): void {
  if (_db) { _db.close(); _db = null; }
  if (_posDb) { _posDb.close(); _posDb = null; }
}

// ── types ───────────────────────────────────────────────────
export interface Supplier {
  supplier_id: string; name: string; contact_phone: string | null;
  contact_email: string | null; lead_time_hours: number; is_active: number;
}

export interface Ingredient {
  ingredient_id: string; name: string; unit: string;
  stock_qty: number; par_qty: number; reorder_qty: number;
  preferred_supplier_id: string | null; cost_per_unit_cents: number; last_consumed_at: string | null;
  is_low?: boolean;
}

// ── ops ─────────────────────────────────────────────────────
export function listSuppliers(opts: { ingredient_id?: string } = {}): Supplier[] {
  const db = getDb();
  if (opts.ingredient_id) {
    const ing = db.prepare(`SELECT preferred_supplier_id FROM ingredient WHERE ingredient_id = ?`).get(opts.ingredient_id) as { preferred_supplier_id: string | null } | undefined;
    if (!ing?.preferred_supplier_id) return [];
    return db.prepare(`SELECT * FROM supplier WHERE supplier_id = ?`).all(ing.preferred_supplier_id) as Supplier[];
  }
  return db.prepare(`SELECT * FROM supplier WHERE is_active = 1 ORDER BY name`).all() as Supplier[];
}

export function getIngredientStock(ingredient_id?: string): Ingredient[] {
  const db = getDb();
  const rows = (ingredient_id
    ? db.prepare(`SELECT * FROM ingredient WHERE ingredient_id = ?`).all(ingredient_id)
    : db.prepare(`SELECT * FROM ingredient ORDER BY ingredient_id`).all()) as Ingredient[];
  return rows.map((r) => ({ ...r, is_low: r.stock_qty < r.par_qty }));
}

export function insertSupplier(s: { supplier_id: string; name: string; contact_phone?: string; contact_email?: string; lead_time_hours?: number }): void {
  getDb().prepare(
    `INSERT OR REPLACE INTO supplier (supplier_id, name, contact_phone, contact_email, lead_time_hours) VALUES (?, ?, ?, ?, ?)`,
  ).run(s.supplier_id, s.name, s.contact_phone ?? null, s.contact_email ?? null, s.lead_time_hours ?? 24);
}

export function insertIngredient(i: { ingredient_id: string; name: string; unit: string; stock_qty: number; par_qty: number; reorder_qty: number; preferred_supplier_id?: string; cost_per_unit_cents?: number }): void {
  getDb().prepare(
    `INSERT OR REPLACE INTO ingredient (ingredient_id, name, unit, stock_qty, par_qty, reorder_qty, preferred_supplier_id, cost_per_unit_cents) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(i.ingredient_id, i.name, i.unit, i.stock_qty, i.par_qty, i.reorder_qty, i.preferred_supplier_id ?? null, i.cost_per_unit_cents ?? 0);
}

// ── consumption ─────────────────────────────────────────────
export interface ConsumptionInput {
  order_id: string;
  ticket_id?: string;
  sku_consumption: Array<{ sku: string; qty: number }>;
}

export interface ConsumptionResult {
  consumed: Array<{ ingredient_id: string; qty: number; remaining_stock: number; is_low: boolean }>;
  low_stock_ingredients: string[];
}

/**
 * Translate sku → ingredient_ids via pos.db menu_item, decrement stock, log audit rows.
 * Returns a per-ingredient result with remaining stock and which crossed below par.
 */
export function recordConsumption(input: ConsumptionInput): ConsumptionResult {
  const db = getDb();
  const posReader = getPosReader();
  const ingredientUsage = new Map<string, number>(); // ingredient_id → total qty

  for (const item of input.sku_consumption) {
    const row = posReader
      .prepare(`SELECT ingredient_ids_json FROM menu_item WHERE sku = ?`)
      .get(item.sku) as { ingredient_ids_json: string } | undefined;
    if (!row) continue;
    const ids = JSON.parse(row.ingredient_ids_json) as string[];
    for (const ing of ids) {
      // Each menu item consumes 1 unit of each listed ingredient per qty ordered.
      // Real restaurants would have a recipe table; prototype simplification: 1:1.
      ingredientUsage.set(`ing_${ing}`, (ingredientUsage.get(`ing_${ing}`) ?? 0) + item.qty);
    }
  }

  const consumed: ConsumptionResult["consumed"] = [];
  const low: string[] = [];

  const tx = db.transaction(() => {
    for (const [ing_id, qty] of ingredientUsage.entries()) {
      // Auto-create ingredient row if missing (so prototype doesn't crash on un-seeded items)
      const existing = db.prepare(`SELECT stock_qty, par_qty FROM ingredient WHERE ingredient_id = ?`).get(ing_id) as { stock_qty: number; par_qty: number } | undefined;
      if (!existing) {
        db.prepare(
          `INSERT INTO ingredient (ingredient_id, name, unit, stock_qty, par_qty, reorder_qty) VALUES (?, ?, 'unit', 100, 10, 50)`,
        ).run(ing_id, ing_id.replace(/^ing_/, "").replace(/_/g, " "));
      }
      db.prepare(
        `UPDATE ingredient SET stock_qty = MAX(stock_qty - ?, 0), last_consumed_at = datetime('now') WHERE ingredient_id = ?`,
      ).run(qty, ing_id);
      db.prepare(
        `INSERT INTO ingredient_consumption (order_id, ticket_id, ingredient_id, qty) VALUES (?, ?, ?, ?)`,
      ).run(input.order_id, input.ticket_id ?? null, ing_id, qty);

      const after = db.prepare(`SELECT stock_qty, par_qty FROM ingredient WHERE ingredient_id = ?`).get(ing_id) as { stock_qty: number; par_qty: number };
      const isLow = after.stock_qty < after.par_qty;
      consumed.push({ ingredient_id: ing_id, qty, remaining_stock: after.stock_qty, is_low: isLow });
      if (isLow) low.push(ing_id);
    }
  });
  tx();
  return { consumed, low_stock_ingredients: low };
}

// ── purchase orders ─────────────────────────────────────────
export function placeSupplierOrder(input: {
  supplier_order_id: string;
  supplier_id: string;
  lines: Array<{ ingredient_id: string; qty: number }>;
}): { supplier_order_id: string; total_cents: number; expected_at: string } {
  const db = getDb();
  const supplier = db.prepare(`SELECT lead_time_hours FROM supplier WHERE supplier_id = ?`).get(input.supplier_id) as { lead_time_hours: number } | undefined;
  if (!supplier) throw new Error(`Unknown supplier: ${input.supplier_id}`);

  let total = 0;
  const lineMetas: Array<{ ingredient_id: string; qty: number; unit_cost_cents: number }> = [];
  for (const line of input.lines) {
    const ing = db.prepare(`SELECT cost_per_unit_cents FROM ingredient WHERE ingredient_id = ?`).get(line.ingredient_id) as { cost_per_unit_cents: number } | undefined;
    const cost = ing?.cost_per_unit_cents ?? 0;
    total += Math.round(line.qty * cost);
    lineMetas.push({ ingredient_id: line.ingredient_id, qty: line.qty, unit_cost_cents: cost });
  }
  const expected_at = new Date(Date.now() + supplier.lead_time_hours * 60 * 60 * 1000).toISOString();

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO supplier_order (supplier_order_id, supplier_id, total_cents, expected_at) VALUES (?, ?, ?, ?)`,
    ).run(input.supplier_order_id, input.supplier_id, total, expected_at);
    const lineInsert = db.prepare(
      `INSERT INTO supplier_order_line (supplier_order_id, ingredient_id, qty, unit_cost_cents) VALUES (?, ?, ?, ?)`,
    );
    for (const l of lineMetas) lineInsert.run(input.supplier_order_id, l.ingredient_id, l.qty, l.unit_cost_cents);
  });
  tx();
  return { supplier_order_id: input.supplier_order_id, total_cents: total, expected_at };
}

export function getLeadTime(opts: { supplier_id?: string; ingredient_id?: string }): { hours: number } {
  const db = getDb();
  if (opts.supplier_id) {
    const row = db.prepare(`SELECT lead_time_hours FROM supplier WHERE supplier_id = ?`).get(opts.supplier_id) as { lead_time_hours: number } | undefined;
    return { hours: row?.lead_time_hours ?? 0 };
  }
  if (opts.ingredient_id) {
    const row = db
      .prepare(`SELECT s.lead_time_hours FROM ingredient i JOIN supplier s ON s.supplier_id = i.preferred_supplier_id WHERE i.ingredient_id = ?`)
      .get(opts.ingredient_id) as { lead_time_hours: number } | undefined;
    return { hours: row?.lead_time_hours ?? 0 };
  }
  return { hours: 0 };
}

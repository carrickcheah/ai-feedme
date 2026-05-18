/**
 * POS MCP — SQLite client (bun:sqlite).
 *
 * One DB per server, kept in `data/pos.db`. WAL mode for concurrent reads.
 */
import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const DB_PATH = process.env.POS_DB_PATH || "./data/pos.db";

let _db: Database | null = null;

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

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

// ── domain types ─────────────────────────────────────────────
export interface MenuItem {
  id: number;
  sku: string;
  code: string;
  name: string;
  description: string | null;
  price_cents: number;
  category: string;
  station: string;
  prep_time_seconds: number;
  allergens: string[];
  ingredient_ids: string[];
  is_available: boolean;
}

export interface Order {
  order_id: string;
  customer_id: string | null;
  session_id: string | null;
  channel: string;
  status: string;
  subtotal_cents: number;
  tax_cents: number;
  discount_cents: number;
  total_cents: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface OrderLine {
  id: number;
  order_id: string;
  menu_item_sku: string;
  qty: number;
  unit_price_cents: number;
  line_total_cents: number;
  modifiers: Record<string, unknown>;
  notes: string | null;
}

// Internal row type — JSON columns still as strings.
interface MenuItemRow {
  id: number;
  sku: string;
  code: string;
  name: string;
  description: string | null;
  price_cents: number;
  category: string;
  station: string;
  prep_time_seconds: number;
  allergens_json: string;
  ingredient_ids_json: string;
  is_available: number;
}

function rowToMenuItem(row: MenuItemRow): MenuItem {
  return {
    id: row.id,
    sku: row.sku,
    code: row.code,
    name: row.name,
    description: row.description,
    price_cents: row.price_cents,
    category: row.category,
    station: row.station,
    prep_time_seconds: row.prep_time_seconds,
    allergens: JSON.parse(row.allergens_json),
    ingredient_ids: JSON.parse(row.ingredient_ids_json),
    is_available: row.is_available === 1,
  };
}

// ── queries ──────────────────────────────────────────────────

export function searchMenu(opts: {
  query?: string;
  category?: string;
  only_available?: boolean;
  limit?: number;
}): MenuItem[] {
  const db = getDb();
  const limit = Math.min(opts.limit ?? 20, 100);
  const onlyAvailable = opts.only_available !== false;
  const rows: MenuItemRow[] = [];

  if (opts.query && opts.query.trim()) {
    // FTS5 search — wrap query, escape special chars, prefix match
    const ftsQuery = opts.query
      .trim()
      .split(/\s+/)
      .map((w) => w.replace(/["']/g, "") + "*")
      .filter((w) => w.length > 1)
      .join(" ");
    if (ftsQuery) {
      const sql = `
        SELECT mi.* FROM menu_item mi
        JOIN menu_item_fts fts ON fts.rowid = mi.id
        WHERE menu_item_fts MATCH ?
        ${opts.category ? "AND mi.category = ?" : ""}
        ${onlyAvailable ? "AND mi.is_available = 1" : ""}
        ORDER BY rank LIMIT ?
      `;
      const params: (string | number)[] = [ftsQuery];
      if (opts.category) params.push(opts.category);
      params.push(limit);
      rows.push(...(db.prepare(sql).all(...params) as MenuItemRow[]));
    }
  } else {
    const sql = `
      SELECT * FROM menu_item
      WHERE 1=1
      ${opts.category ? "AND category = ?" : ""}
      ${onlyAvailable ? "AND is_available = 1" : ""}
      ORDER BY category, code LIMIT ?
    `;
    const params: (string | number)[] = [];
    if (opts.category) params.push(opts.category);
    params.push(limit);
    rows.push(...(db.prepare(sql).all(...params) as MenuItemRow[]));
  }

  return rows.map(rowToMenuItem);
}

export function getMenuItemBySku(sku: string): MenuItem | null {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM menu_item WHERE sku = ?`).get(sku) as MenuItemRow | undefined;
  return row ? rowToMenuItem(row) : null;
}

export function insertMenuItem(item: {
  sku: string;
  code: string;
  name: string;
  description: string | null;
  price_cents: number;
  category: string;
  station: string;
  prep_time_seconds: number;
  allergens: string[];
  ingredient_ids: string[];
  is_available?: boolean;
}): void {
  const db = getDb();
  db.prepare(
    `INSERT OR REPLACE INTO menu_item
     (sku, code, name, description, price_cents, category, station, prep_time_seconds,
      allergens_json, ingredient_ids_json, is_available)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    item.sku,
    item.code,
    item.name,
    item.description,
    item.price_cents,
    item.category,
    item.station,
    item.prep_time_seconds,
    JSON.stringify(item.allergens),
    JSON.stringify(item.ingredient_ids),
    item.is_available !== false ? 1 : 0,
  );
}

// ── orders ──────────────────────────────────────────────────

interface OrderRow {
  order_id: string;
  customer_id: string | null;
  session_id: string | null;
  channel: string;
  status: string;
  subtotal_cents: number;
  tax_cents: number;
  discount_cents: number;
  total_cents: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface RecentOrder {
  order_id: string;
  status: string;
  channel: string;
  total_cents: number;
  created_at: string;
  items_summary: string;
}

export function listRecentOrders(opts: {
  customer_id?: string | null;
  session_id?: string | null;
  limit?: number;
}): RecentOrder[] {
  if (!opts.customer_id && !opts.session_id) return [];
  const db = getDb();
  const limit = Math.min(Math.max(opts.limit ?? 5, 1), 50);

  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.customer_id) {
    where.push(`customer_id = ?`);
    params.push(opts.customer_id);
  }
  if (opts.session_id) {
    where.push(`session_id = ?`);
    params.push(opts.session_id);
  }
  params.push(limit);

  const orderRows = db
    .prepare(
      `SELECT order_id, channel, status, total_cents, created_at
       FROM "order"
       WHERE ${where.join(" OR ")}
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .all(...(params as never[])) as Array<{
      order_id: string;
      channel: string;
      status: string;
      total_cents: number;
      created_at: string;
    }>;
  if (!orderRows.length) return [];

  const ids = orderRows.map((r) => r.order_id);
  const placeholders = ids.map(() => "?").join(",");
  const lineRows = db
    .prepare(
      `SELECT ol.order_id, ol.qty, COALESCE(mi.name, ol.menu_item_sku) AS name
       FROM order_line ol
       LEFT JOIN menu_item mi ON mi.sku = ol.menu_item_sku
       WHERE ol.order_id IN (${placeholders})`,
    )
    .all(...(ids as never[])) as Array<{ order_id: string; qty: number; name: string }>;

  const linesByOrder = new Map<string, Array<{ qty: number; name: string }>>();
  for (const l of lineRows) {
    const arr = linesByOrder.get(l.order_id) ?? [];
    arr.push({ qty: l.qty, name: l.name });
    linesByOrder.set(l.order_id, arr);
  }

  return orderRows.map((r) => ({
    order_id: r.order_id,
    status: r.status,
    channel: r.channel,
    total_cents: r.total_cents,
    created_at: r.created_at,
    items_summary:
      (linesByOrder.get(r.order_id) ?? []).map((l) => `${l.qty}× ${l.name}`).join(", ") || "(empty)",
  }));
}

export function getOrderById(order_id: string): { order: Order; lines: OrderLine[] } | null {
  const db = getDb();
  const order = db.prepare(`SELECT * FROM "order" WHERE order_id = ?`).get(order_id) as OrderRow | undefined;
  if (!order) return null;
  const lineRows = db
    .prepare(`SELECT * FROM order_line WHERE order_id = ?`)
    .all(order_id) as Array<{
      id: number;
      order_id: string;
      menu_item_sku: string;
      qty: number;
      unit_price_cents: number;
      line_total_cents: number;
      modifiers_json: string;
      notes: string | null;
    }>;
  return {
    order: order,
    lines: lineRows.map((r) => ({
      id: r.id,
      order_id: r.order_id,
      menu_item_sku: r.menu_item_sku,
      qty: r.qty,
      unit_price_cents: r.unit_price_cents,
      line_total_cents: r.line_total_cents,
      modifiers: JSON.parse(r.modifiers_json),
      notes: r.notes,
    })),
  };
}

export interface CreateOrderInput {
  order_id: string;
  customer_id: string | null;
  session_id: string | null;
  channel: string;
  items: Array<{
    sku: string;
    qty: number;
    modifiers?: Record<string, unknown>;
    notes?: string;
  }>;
  notes?: string;
}

export interface CreateOrderResult {
  order_id: string;
  subtotal_cents: number;
  tax_cents: number;
  discount_cents: number;
  total_cents: number;
}

export function createOrder(input: CreateOrderInput): CreateOrderResult {
  const db = getDb();
  // Validate every SKU + availability up front
  const skuMap = new Map<string, MenuItem>();
  for (const item of input.items) {
    const mi = getMenuItemBySku(item.sku);
    if (!mi) throw new Error(`Unknown SKU: ${item.sku}`);
    if (!mi.is_available) throw new Error(`SKU is 86'd (not available): ${item.sku}`);
    skuMap.set(item.sku, mi);
  }

  const lines = input.items.map((it) => {
    const mi = skuMap.get(it.sku)!;
    return {
      sku: it.sku,
      qty: it.qty,
      unit_price_cents: mi.price_cents,
      line_total_cents: mi.price_cents * it.qty,
      modifiers_json: JSON.stringify(it.modifiers ?? {}),
      notes: it.notes ?? null,
    };
  });

  const subtotal = lines.reduce((s, l) => s + l.line_total_cents, 0);
  const tax_cents = 0; // SST disabled in prototype (env.SST_PERCENT = 0)
  const discount_cents = 0;
  const total_cents = subtotal + tax_cents - discount_cents;

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO "order"
       (order_id, customer_id, session_id, channel, status, subtotal_cents, tax_cents, discount_cents, total_cents, notes)
       VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)`,
    ).run(
      input.order_id,
      input.customer_id,
      input.session_id,
      input.channel,
      subtotal,
      tax_cents,
      discount_cents,
      total_cents,
      input.notes ?? null,
    );
    const lineInsert = db.prepare(
      `INSERT INTO order_line
       (order_id, menu_item_sku, qty, unit_price_cents, line_total_cents, modifiers_json, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const l of lines) {
      lineInsert.run(
        input.order_id,
        l.sku,
        l.qty,
        l.unit_price_cents,
        l.line_total_cents,
        l.modifiers_json,
        l.notes,
      );
    }
  });
  tx();

  return { order_id: input.order_id, subtotal_cents: subtotal, tax_cents, discount_cents, total_cents };
}

export function updateOrderStatus(order_id: string, status: string): boolean {
  const db = getDb();
  const valid = ["pending", "confirmed", "preparing", "ready", "delivered", "cancelled"];
  if (!valid.includes(status)) throw new Error(`Invalid status: ${status}`);
  const res = db
    .prepare(`UPDATE "order" SET status = ?, updated_at = datetime('now') WHERE order_id = ?`)
    .run(status, order_id);
  return res.changes > 0;
}

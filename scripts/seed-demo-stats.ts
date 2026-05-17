#!/usr/bin/env bun
/**
 * scripts/seed-demo-stats.ts
 *
 * Nudges the SQLite DBs into a demo-friendly state so the Kitchen and
 * Inventory dashboards tell a sharper story for interview walkthroughs.
 *
 * What it does:
 *  - supplier.db: pushes 3 ingredients to <par for "red bars" + 2 to mid
 *  - supplier.db: inserts 2 supplier_order rows dated today
 *  - kitchen-display.db: inserts ~20 tickets spread across today's hours,
 *    mix of statuses (queued / cooking / plated / delivered)
 *  - pos.db: marks 4 additional menu items as is_available=0 (total 5 "86'd")
 *
 * Idempotent-ish — running twice doubles the tickets but won't crash.
 * Run: bun scripts/seed-demo-stats.ts
 */
import { Database } from "bun:sqlite";
import { ulid } from "ulid";

const supplier = new Database("./data/supplier.db");
const kds = new Database("./data/kitchen-display.db");
const pos = new Database("./data/pos.db");

// ─── INVENTORY: ingredients below par ───────────────────────────
const lowStock: Array<[string, number]> = [
  ["ing_cookie_crumb", 0.2],      // Oreo crumb — 0.2kg vs par
  ["ing_korean_sauce", 0.5],      // Korean sauce — 0.5kg
  ["ing_blueberry",    0.3],      // Blueberries
  ["ing_mango_chunk",  1.5],      // Mango chunks — at 50%
  ["ing_coconut",      0.8],      // Coconut shred
];
const upd = supplier.prepare(`UPDATE ingredient SET stock_qty = ? WHERE ingredient_id = ?`);
let touched = 0;
for (const [id, q] of lowStock) {
  const r = upd.run(q, id);
  if (r.changes > 0) touched++;
}
console.log(`[seed] ingredients adjusted: ${touched}/${lowStock.length}`);

// ─── INVENTORY: supplier orders dated today ─────────────────────
const supplierIds = (supplier.prepare("SELECT supplier_id FROM supplier").all() as Array<{ supplier_id: string }>)
  .map((r) => r.supplier_id);
const insOrder = supplier.prepare(
  `INSERT INTO supplier_order (supplier_order_id, supplier_id, status, total_cents, ordered_at)
   VALUES (?, ?, 'pending', ?, datetime('now', ?))`,
);
const todayOrders: Array<[string, number]> = [
  [supplierIds[0] ?? "sup_1", 18500],
  [supplierIds[1] ?? supplierIds[0] ?? "sup_1", 9800],
];
for (let i = 0; i < todayOrders.length; i++) {
  const [sid, total] = todayOrders[i]!;
  const minsAgo = (i + 1) * 73;
  insOrder.run(`sop_${ulid()}`, sid, total, `-${minsAgo} minutes`);
}
console.log(`[seed] supplier orders today: +${todayOrders.length}`);

// ─── KITCHEN: spread tickets across today's hours ───────────────
const menuItems = (pos.prepare("SELECT sku, code, name FROM menu_item LIMIT 30").all() as Array<{ sku: string; code: string; name: string }>);
const stations = ["cold", "fry", "grill", "bev"];
const statuses = ["queued", "queued", "cooking", "plated", "delivered", "delivered"];
const insTicket = kds.prepare(
  `INSERT INTO ticket (ticket_id, order_id, station, status, ready_at, created_at, updated_at)
   VALUES (?, ?, ?, ?, ?, datetime('now', ?), datetime('now', ?))`,
);
const insLine = kds.prepare(
  `INSERT INTO ticket_line (ticket_id, menu_item_sku, menu_item_code, menu_item_name, qty, modifiers_json, status)
   VALUES (?, ?, ?, ?, ?, '{}', ?)`,
);
const TICKETS = 22;
for (let i = 0; i < TICKETS; i++) {
  // Spread tickets backward in time across the last 9 hours
  const minsAgo = Math.floor(Math.random() * 540) + 5;  // 5–545 min ago
  const station = stations[i % stations.length]!;
  const status = statuses[i % statuses.length]!;
  const ticketId = `tkt_${ulid()}`;
  const orderId = `ord_${ulid().slice(0, 8)}`;
  const cookSec = 240 + Math.floor(Math.random() * 360);  // 4–10 min
  const readyAt = ["plated", "delivered"].includes(status)
    ? `datetime('now', '-${minsAgo} minutes', '+${cookSec} seconds')`
    : null;
  // Use a raw insert with computed readyAt
  const stmt = kds.prepare(
    `INSERT INTO ticket (ticket_id, order_id, station, status, ready_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ${readyAt ? readyAt : "NULL"}, datetime('now', '-${minsAgo} minutes'), datetime('now', '-${minsAgo} minutes'))`,
  );
  stmt.run(ticketId, orderId, station, status);

  // 1–2 lines per ticket
  const lineCount = 1 + Math.floor(Math.random() * 2);
  for (let j = 0; j < lineCount; j++) {
    const mi = menuItems[Math.floor(Math.random() * menuItems.length)]!;
    insLine.run(ticketId, mi.sku, mi.code, mi.name, 1 + Math.floor(Math.random() * 2), "queued");
  }
}
console.log(`[seed] tickets inserted: ${TICKETS}`);

// ─── POS: Sarah's historical orders (so "my last order" works) ──
// Stable order IDs → INSERT OR IGNORE → idempotent across re-runs.
const sarahMenu = pos
  .prepare(`SELECT sku, price_cents, name FROM menu_item WHERE is_available = 1 LIMIT 30`)
  .all() as Array<{ sku: string; price_cents: number; name: string }>;
if (sarahMenu.length >= 5) {
  const insSarahOrder = pos.prepare(
    `INSERT OR IGNORE INTO "order"
     (order_id, customer_id, session_id, channel, status,
      subtotal_cents, tax_cents, discount_cents, total_cents,
      created_at, updated_at)
     VALUES (?, 'cust_sarah_001', NULL, 'web', 'delivered',
             ?, 0, 0, ?,
             datetime('now', ?), datetime('now', ?))`,
  );
  const insSarahLine = pos.prepare(
    `INSERT OR IGNORE INTO order_line
     (order_id, menu_item_sku, qty, unit_price_cents, line_total_cents, modifiers_json, notes)
     VALUES (?, ?, ?, ?, ?, '{}', NULL)`,
  );
  const sarahOrders = [
    { id: "ord_sarah_demo_1", daysAgo: 2,  picks: [[0, 1], [3, 2]] as Array<[number, number]> },
    { id: "ord_sarah_demo_2", daysAgo: 5,  picks: [[1, 1]] as Array<[number, number]> },
    { id: "ord_sarah_demo_3", daysAgo: 10, picks: [[2, 2], [4, 1]] as Array<[number, number]> },
  ];
  let sarahInserted = 0;
  for (const o of sarahOrders) {
    const lines = o.picks.map(([idx, qty]) => {
      const mi = sarahMenu[idx]!;
      return { sku: mi.sku, qty, unit: mi.price_cents, total: mi.price_cents * qty };
    });
    const total = lines.reduce((s, l) => s + l.total, 0);
    const off = `-${o.daysAgo} days`;
    const r = insSarahOrder.run(o.id, total, total, off, off);
    if (r.changes > 0) {
      sarahInserted++;
      for (const l of lines) insSarahLine.run(o.id, l.sku, l.qty, l.unit, l.total);
    }
  }
  console.log(`[seed] Sarah historical orders: +${sarahInserted} (idempotent)`);
} else {
  console.log("[seed] skipping Sarah orders — menu not seeded enough");
}

// ─── POS: mark 4 more menu items as 86'd ────────────────────────
const ext86 = pos.prepare(
  `UPDATE menu_item SET is_available = 0
   WHERE sku IN (
     SELECT sku FROM menu_item WHERE is_available = 1 ORDER BY RANDOM() LIMIT 4
   )`,
);
const r86 = ext86.run();
console.log(`[seed] menu items 86'd: +${r86.changes}`);

supplier.close();
kds.close();
pos.close();
console.log("[seed] done. Reload the dashboards.");

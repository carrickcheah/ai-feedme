/**
 * Kitchen Display MCP — SQLite client.
 * Opens pos.db read-only to look up menu metadata (station, prep_time, name, code).
 */
import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const KDS_DB_PATH = process.env.KDS_DB_PATH || "./data/kitchen-display.db";
const POS_DB_PATH = process.env.POS_DB_PATH || "./data/pos.db";

let _db: Database | null = null;
let _posDb: Database | null = null;

export function getDb(): Database {
  if (_db) return _db;
  _db = new Database(KDS_DB_PATH, { create: true });
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

// ── domain ──────────────────────────────────────────────────
export interface MenuMeta {
  sku: string;
  code: string;
  name: string;
  station: string;
  prep_time_seconds: number;
}

export function getMenuMeta(sku: string): MenuMeta | null {
  const row = getPosReader()
    .prepare(`SELECT sku, code, name, station, prep_time_seconds FROM menu_item WHERE sku = ?`)
    .get(sku) as MenuMeta | undefined;
  return row ?? null;
}

export interface TicketInput {
  order_id: string;
  items: Array<{ sku: string; qty: number; modifiers?: Record<string, unknown> }>;
  priority?: number;
}

export interface TicketResult {
  ticket_id: string;
  station: string;
  lines: number;
  fire_at: string | null;
  estimated_ready_at: string;
}

/**
 * Split items by station, create one ticket per station for this order.
 * Compute fire_at so multi-station items plate together (longest cook starts first).
 */
export function sendTicketsForOrder(input: TicketInput): TicketResult[] {
  const db = getDb();
  const grouped = new Map<string, { meta: MenuMeta; line: { sku: string; qty: number; modifiers: Record<string, unknown> } }[]>();
  let maxPrep = 0;

  for (const item of input.items) {
    const meta = getMenuMeta(item.sku);
    if (!meta) throw new Error(`Unknown SKU: ${item.sku}`);
    if (!grouped.has(meta.station)) grouped.set(meta.station, []);
    grouped.get(meta.station)!.push({ meta, line: { sku: item.sku, qty: item.qty, modifiers: item.modifiers ?? {} } });
    if (meta.prep_time_seconds > maxPrep) maxPrep = meta.prep_time_seconds;
  }

  const now = Date.now();
  const priority = input.priority ?? 0;
  const results: TicketResult[] = [];

  const tx = db.transaction(() => {
    for (const [station, group] of grouped.entries()) {
      const ticket_id = `tkt_${crypto.randomUUID().slice(0, 18).replace(/-/g, "")}`;
      // Earliest-fire item in this group sets the station's fire offset
      const stationMaxPrep = Math.max(...group.map((g) => g.meta.prep_time_seconds));
      const fireDelaySec = Math.max(0, maxPrep - stationMaxPrep);
      const fire_at = new Date(now + fireDelaySec * 1000).toISOString();
      const ready_at = new Date(now + maxPrep * 1000).toISOString();

      db.prepare(
        `INSERT INTO ticket (ticket_id, order_id, station, priority, fire_at) VALUES (?, ?, ?, ?, ?)`,
      ).run(ticket_id, input.order_id, station, priority, fire_at);

      const lineInsert = db.prepare(
        `INSERT INTO ticket_line (ticket_id, menu_item_sku, menu_item_code, menu_item_name, qty, modifiers_json)
         VALUES (?, ?, ?, ?, ?, ?)`,
      );
      for (const { meta, line } of group) {
        lineInsert.run(ticket_id, line.sku, meta.code, meta.name, line.qty, JSON.stringify(line.modifiers));
      }
      // bump station queue depth
      db.prepare(`UPDATE station SET queue_depth = queue_depth + 1, updated_at = datetime('now') WHERE name = ?`).run(station);
      results.push({ ticket_id, station, lines: group.length, fire_at, estimated_ready_at: ready_at });
    }
  });
  tx();
  return results;
}

export function markReady(ticket_id: string): { ok: boolean; ready_at: string | null } {
  const db = getDb();
  const ready_at = new Date().toISOString();
  const row = db.prepare(`SELECT station FROM ticket WHERE ticket_id = ?`).get(ticket_id) as { station: string } | undefined;
  if (!row) return { ok: false, ready_at: null };
  const tx = db.transaction(() => {
    db.prepare(`UPDATE ticket SET status = 'plated', ready_at = ?, updated_at = datetime('now') WHERE ticket_id = ?`).run(ready_at, ticket_id);
    db.prepare(`UPDATE station SET queue_depth = MAX(queue_depth - 1, 0), updated_at = datetime('now') WHERE name = ?`).run(row.station);
  });
  tx();
  return { ok: true, ready_at };
}

export function expedite(ticket_id: string, boost = 10): { new_priority: number } | null {
  const db = getDb();
  const row = db.prepare(`SELECT priority FROM ticket WHERE ticket_id = ?`).get(ticket_id) as { priority: number } | undefined;
  if (!row) return null;
  const newP = row.priority + boost;
  db.prepare(`UPDATE ticket SET priority = ?, updated_at = datetime('now') WHERE ticket_id = ?`).run(newP, ticket_id);
  return { new_priority: newP };
}

export function getQueue(opts: { station?: string }): {
  tickets: Array<{ ticket_id: string; order_id: string; station: string; priority: number; fire_at: string | null; age_s: number; status: string; lines: number }>;
  total_count: number;
  overloaded_stations: string[];
} {
  const db = getDb();
  const sql = `
    SELECT t.ticket_id, t.order_id, t.station, t.priority, t.fire_at, t.status, t.created_at,
           (SELECT COUNT(*) FROM ticket_line tl WHERE tl.ticket_id = t.ticket_id) AS lines
    FROM ticket t
    WHERE t.status IN ('queued','firing','cooking')
    ${opts.station ? "AND t.station = ?" : ""}
    ORDER BY t.priority DESC, t.fire_at ASC
  `;
  const params: string[] = opts.station ? [opts.station] : [];
  const rows = db.prepare(sql).all(...params) as Array<{
    ticket_id: string; order_id: string; station: string; priority: number;
    fire_at: string | null; status: string; created_at: string; lines: number;
  }>;
  const now = Date.now();
  const tickets = rows.map((r) => ({
    ticket_id: r.ticket_id,
    order_id: r.order_id,
    station: r.station,
    priority: r.priority,
    fire_at: r.fire_at,
    status: r.status,
    lines: r.lines,
    age_s: Math.floor((now - new Date(r.created_at + "Z").getTime()) / 1000),
  }));
  const overloaded = (db.prepare(`SELECT name FROM station WHERE queue_depth > 5`).all() as Array<{ name: string }>).map((r) => r.name);
  return { tickets, total_count: tickets.length, overloaded_stations: overloaded };
}

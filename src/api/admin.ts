/**
 * /api/admin — read-only dashboard stats from the SQLite DBs.
 *
 * Opens the per-MCP DBs in READONLY mode (SQLite WAL allows concurrent
 * readers alongside the MCP servers' writers). No MCP roundtrip — direct
 * SQL aggregations for human BI dashboards.
 */
import { Hono } from "hono";
import { Database } from "bun:sqlite";
import { logger } from "../lib/logger";

const SUPPLIER_DB = "./data/supplier.db";
const KITCHEN_DB = "./data/kitchen-display.db";
const POS_DB = "./data/pos.db";

function openRO(path: string): Database {
  return new Database(path, { readonly: true });
}

function safeAll<T = Record<string, unknown>>(db: Database, sql: string, params: unknown[] = []): T[] {
  try {
    return db.prepare(sql).all(...(params as never[])) as T[];
  } catch (err) {
    logger.warn({ sql, err: String(err) }, "[ADMIN] query failed");
    return [];
  }
}

function safeOne<T = Record<string, unknown>>(db: Database, sql: string, params: unknown[] = []): T | null {
  try {
    return (db.prepare(sql).get(...(params as never[])) as T) ?? null;
  } catch (err) {
    logger.warn({ sql, err: String(err) }, "[ADMIN] query failed");
    return null;
  }
}

const adminApp = new Hono();

// ─── Inventory stats ────────────────────────────────────────────
adminApp.get("/inventory-stats", (c) => {
  const sup = openRO(SUPPLIER_DB);
  const pos = openRO(POS_DB);
  try {
    // KPIs
    const totalIng  = (safeOne<{ n: number }>(sup, "SELECT COUNT(*) AS n FROM ingredient")?.n) ?? 0;
    const belowPar  = (safeOne<{ n: number }>(sup, "SELECT COUNT(*) AS n FROM ingredient WHERE stock_qty < par_qty")?.n) ?? 0;
    const reordersToday = (safeOne<{ n: number }>(sup, "SELECT COUNT(*) AS n FROM supplier_order WHERE date(ordered_at) = date('now')")?.n) ?? 0;
    const items86 = (safeOne<{ n: number }>(pos, "SELECT COUNT(*) AS n FROM menu_item WHERE is_available = 0")?.n) ?? 0;

    // Chart: 10 ingredients sorted by stock-vs-par % ascending (worst first)
    const stockRows = safeAll<{ name: string; pct: number }>(
      sup,
      `SELECT name,
              CAST(ROUND(stock_qty * 100.0 / NULLIF(par_qty, 0)) AS INTEGER) AS pct
       FROM ingredient
       WHERE par_qty > 0
       ORDER BY pct ASC
       LIMIT 10`,
    );

    // Activity: recent supplier_orders (REORDER) + recent ingredient_consumption (CONSUMED)
    // Combine, sort by time desc, limit 6
    const reorders = safeAll<{ id: string; supplier: string; ts: string }>(
      sup,
      `SELECT so.supplier_order_id AS id,
              s.name AS supplier,
              so.ordered_at AS ts
       FROM supplier_order so
       LEFT JOIN supplier s ON s.supplier_id = so.supplier_id
       ORDER BY so.ordered_at DESC
       LIMIT 6`,
    );
    const consumed = safeAll<{ id: string; ingredient: string; qty: number; ts: string }>(
      sup,
      `SELECT ic.ingredient_id AS id,
              i.name AS ingredient,
              ic.qty AS qty,
              ic.consumed_at AS ts
       FROM ingredient_consumption ic
       LEFT JOIN ingredient i ON i.ingredient_id = ic.ingredient_id
       ORDER BY ic.consumed_at DESC
       LIMIT 6`,
    );
    const belowParRows = safeAll<{ id: string; name: string; pct: number }>(
      sup,
      `SELECT ingredient_id AS id, name,
              CAST(ROUND(stock_qty * 100.0 / NULLIF(par_qty, 0)) AS INTEGER) AS pct
       FROM ingredient WHERE stock_qty < par_qty
       ORDER BY pct ASC LIMIT 4`,
    );

    // Truncate IDs to keep them inside the 110px ID column (kitchen endpoint
    // does the same with ticket IDs). Full ID stays in the DB; only display
    // form is shortened.
    const shortId = (id: string) => (id.length > 12 ? id.slice(0, 12) : id);
    const activity = [
      ...belowParRows.map((r) => ({
        time: "now",
        id: shortId(r.id),
        text: `${r.name}: ${r.pct}% of par`,
        status: "STOCK.LOW",
      })),
      ...reorders.map((r) => ({
        time: r.ts ? new Date(r.ts).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "—",
        id: shortId(r.id),
        text: r.supplier ? `via ${r.supplier}` : "supplier order placed",
        status: "REORDER",
      })),
      ...consumed.slice(0, 3).map((r) => ({
        time: r.ts ? new Date(r.ts).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "—",
        id: shortId(r.id),
        text: `${r.ingredient}: -${r.qty}`,
        status: "CONSUMED",
      })),
    ].slice(0, 6);

    return c.json({
      kpis: [
        { icon: "pkg",   value: String(totalIng),       label: "ingredients" },
        { icon: "alert", value: String(belowPar),       label: "below par",     tone: belowPar > 0 ? "warn" : undefined },
        { icon: "truck", value: String(reordersToday),  label: "reorders today" },
        { icon: "off",   value: String(items86),        label: "items 86'd",    tone: items86 > 0 ? "warn" : undefined },
      ],
      chart: {
        title: "Stock levels (% of par) · 10 lowest",
        scale: "percent",
        labels: stockRows.map((r) => (r.name.split(" ")[0] ?? r.name).slice(0, 12)),
        values: stockRows.map((r) => Math.min(100, r.pct)),  // cap at 100 for visual fairness
      },
      activity,
      status: { label: "Live", since: "data from supplier.db + pos.db" },
    });
  } finally {
    sup.close();
    pos.close();
  }
});

// ─── Kitchen stats ──────────────────────────────────────────────
adminApp.get("/kitchen-stats", (c) => {
  const kds = openRO(KITCHEN_DB);
  try {
    // KPIs
    const ticketsToday = (safeOne<{ n: number }>(kds, "SELECT COUNT(*) AS n FROM ticket WHERE date(created_at) = date('now')")?.n) ?? 0;
    // Avg cook time: difference between ready_at and created_at for ready/delivered tickets today
    const avgRow = safeOne<{ avg_sec: number }>(
      kds,
      `SELECT AVG(strftime('%s', ready_at) - strftime('%s', created_at)) AS avg_sec
       FROM ticket
       WHERE ready_at IS NOT NULL AND date(created_at) = date('now')`,
    );
    const avgSec = Math.round(avgRow?.avg_sec ?? 0);
    const avgMmSs = avgSec > 0
      ? `${Math.floor(avgSec / 60)}m ${String(avgSec % 60).padStart(2, "0")}s`
      : "—";
    const inQueue = (safeOne<{ n: number }>(kds, "SELECT COUNT(*) AS n FROM ticket WHERE status IN ('queued', 'firing', 'cooking')")?.n) ?? 0;

    // On-time rate: % of completed tickets where ready_at - created_at <= 10min (600s)
    const otRow = safeOne<{ total: number; on_time: number }>(
      kds,
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN (strftime('%s', ready_at) - strftime('%s', created_at)) <= 600 THEN 1 ELSE 0 END) AS on_time
       FROM ticket
       WHERE ready_at IS NOT NULL AND date(created_at) = date('now')`,
    );
    const onTimeTotal = otRow?.total ?? 0;
    const onTimeOn = otRow?.on_time ?? 0;
    const onTimePct = onTimeTotal > 0
      ? Math.round((onTimeOn / onTimeTotal) * 100)
      : (ticketsToday > 0 ? 100 : 0);

    // Chart: tickets per hour, last 12 hours (oldest → newest)
    const hourRows = safeAll<{ hour: number; n: number }>(
      kds,
      `SELECT CAST(strftime('%H', created_at) AS INTEGER) AS hour, COUNT(*) AS n
       FROM ticket
       WHERE created_at >= datetime('now', '-12 hours')
       GROUP BY hour
       ORDER BY hour ASC`,
    );
    const hourMap = new Map(hourRows.map((r) => [r.hour, r.n]));
    const now = new Date();
    const chartLabels: string[] = [];
    const chartValues: number[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 3600_000);
      const h = d.getHours();
      const label = h === 0 ? "12a" : h < 12 ? `${h}a` : h === 12 ? "12p" : `${h - 12}p`;
      chartLabels.push(label);
      chartValues.push(hourMap.get(h) ?? 0);
    }

    // Activity: last 6 tickets, with first menu_item_name + qty
    const acts = safeAll<{ id: string; status: string; ts: string; lines: string }>(
      kds,
      `SELECT t.ticket_id AS id,
              t.status,
              t.created_at AS ts,
              (SELECT GROUP_CONCAT(qty || '× ' || menu_item_name, ' · ')
                 FROM ticket_line WHERE ticket_id = t.ticket_id) AS lines
       FROM ticket t
       ORDER BY t.created_at DESC
       LIMIT 6`,
    );
    const STATUS_MAP: Record<string, string> = {
      queued: "SENT",
      firing: "COOKING",
      cooking: "COOKING",
      plated: "READY",
      delivered: "DONE",
      cancelled: "DONE",
    };
    const activity = acts.map((a) => ({
      time: a.ts ? new Date(a.ts).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "—",
      id: a.id.slice(0, 12),
      text: a.lines ?? "(empty)",
      status: STATUS_MAP[a.status] ?? a.status.toUpperCase(),
    }));

    return c.json({
      kpis: [
        { icon: "ticket", value: String(ticketsToday), label: "tickets today" },
        { icon: "clock",  value: avgMmSs,              label: "avg cook time" },
        { icon: "check",  value: `${onTimePct}%`,      label: "on-time rate" },
        { icon: "queue",  value: String(inQueue),      label: "in queue", tone: inQueue > 5 ? "warn" : undefined },
      ],
      chart: {
        title: "Tickets per hour (last 12h)",
        labels: chartLabels,
        values: chartValues,
      },
      activity,
      status: { label: "Live", since: "data from kitchen-display.db" },
    });
  } finally {
    kds.close();
  }
});

export { adminApp };

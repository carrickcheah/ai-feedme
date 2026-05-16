/**
 * Payment MCP — SQLite client.
 * Phase 1: stubs only. Phase 4 wires HITL approval for refunds.
 */
import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const DB_PATH = process.env.PAYMENT_DB_PATH || "./data/payment.db";

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

export function closeDb(): void { if (_db) { _db.close(); _db = null; } }

// ── types ───────────────────────────────────────────────────
export interface PaymentIntent {
  intent_id: string;
  order_id: string;
  amount_cents: number;
  currency: string;
  method: string | null;
  status: string;
  created_at: string;
  captured_at: string | null;
}

export interface ProcessPaymentInput {
  intent_id: string;
  order_id: string;
  amount_cents: number;
  method: string;
  metadata?: Record<string, unknown>;
}

// ── ops ─────────────────────────────────────────────────────
export function processPayment(input: ProcessPaymentInput): PaymentIntent {
  const db = getDb();
  // Prototype: every payment auto-captures (no real processor wired up)
  const captured_at = new Date().toISOString();
  db.prepare(
    `INSERT INTO payment_intent (intent_id, order_id, amount_cents, method, status, captured_at, metadata_json)
     VALUES (?, ?, ?, ?, 'captured', ?, ?)`,
  ).run(input.intent_id, input.order_id, input.amount_cents, input.method, captured_at, JSON.stringify(input.metadata ?? {}));
  return {
    intent_id: input.intent_id,
    order_id: input.order_id,
    amount_cents: input.amount_cents,
    currency: "MYR",
    method: input.method,
    status: "captured",
    created_at: captured_at,
    captured_at,
  };
}

export function voidPayment(intent_id: string): boolean {
  const db = getDb();
  const res = db
    .prepare(`UPDATE payment_intent SET status = 'voided' WHERE intent_id = ? AND status != 'captured'`)
    .run(intent_id);
  return res.changes > 0;
}

export function getPayment(opts: { intent_id?: string; order_id?: string }): PaymentIntent | null {
  const db = getDb();
  if (opts.intent_id) {
    const row = db.prepare(`SELECT * FROM payment_intent WHERE intent_id = ?`).get(opts.intent_id) as PaymentIntent | undefined;
    return row ?? null;
  }
  if (opts.order_id) {
    const row = db.prepare(`SELECT * FROM payment_intent WHERE order_id = ?`).get(opts.order_id) as PaymentIntent | undefined;
    return row ?? null;
  }
  return null;
}

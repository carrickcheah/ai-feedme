-- Payment MCP — payment intents + refunds + HITL pending approvals.

CREATE TABLE IF NOT EXISTS payment_intent (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  intent_id     TEXT    NOT NULL UNIQUE,
  order_id      TEXT    NOT NULL UNIQUE,
  amount_cents  INTEGER NOT NULL,
  currency      TEXT    NOT NULL DEFAULT 'MYR',
  method        TEXT,
  status        TEXT    NOT NULL DEFAULT 'pending',
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  captured_at   TEXT,
  metadata_json TEXT    NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS refund (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  refund_id         TEXT    NOT NULL UNIQUE,
  payment_intent_id TEXT    NOT NULL,
  amount_cents      INTEGER NOT NULL,
  reason            TEXT,
  approved_by       TEXT,
  approved_at       TEXT,
  status            TEXT    NOT NULL DEFAULT 'pending',
  created_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS pending_approval (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  approval_id  TEXT    NOT NULL UNIQUE,
  agent        TEXT    NOT NULL,
  tool_name    TEXT    NOT NULL,
  args_json    TEXT    NOT NULL,
  status       TEXT    NOT NULL DEFAULT 'pending',
  reason       TEXT,
  requested_at TEXT    NOT NULL DEFAULT (datetime('now')),
  resolved_at  TEXT,
  resolved_by  TEXT,
  expires_at   TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pending_status ON pending_approval(status, requested_at);

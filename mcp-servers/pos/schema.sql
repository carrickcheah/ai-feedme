-- POS MCP — SQLite schema for menu, orders, customers.
-- Idempotent: every CREATE uses IF NOT EXISTS.

-- ───────────────────────────────────────────────────────────
-- menu_item
-- ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS menu_item (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  sku                 TEXT    NOT NULL UNIQUE,
  code                TEXT    NOT NULL UNIQUE,                  -- "YS01", "CB01", etc — matches frontend
  name                TEXT    NOT NULL,
  description         TEXT,
  price_cents         INTEGER NOT NULL,
  category            TEXT    NOT NULL,
  station             TEXT    NOT NULL,
  prep_time_seconds   INTEGER NOT NULL DEFAULT 120,
  allergens_json      TEXT    NOT NULL DEFAULT '[]',
  ingredient_ids_json TEXT    NOT NULL DEFAULT '[]',
  is_available        INTEGER NOT NULL DEFAULT 1,
  created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE VIRTUAL TABLE IF NOT EXISTS menu_item_fts USING fts5(
  name, description, category, code,
  content='menu_item', content_rowid='id', tokenize='porter unicode61'
);

CREATE TRIGGER IF NOT EXISTS menu_item_ai AFTER INSERT ON menu_item BEGIN
  INSERT INTO menu_item_fts(rowid, name, description, category, code)
  VALUES (new.id, new.name, new.description, new.category, new.code);
END;
CREATE TRIGGER IF NOT EXISTS menu_item_au AFTER UPDATE ON menu_item BEGIN
  INSERT INTO menu_item_fts(menu_item_fts, rowid, name, description, category, code)
    VALUES('delete', old.id, old.name, old.description, old.category, old.code);
  INSERT INTO menu_item_fts(rowid, name, description, category, code)
    VALUES (new.id, new.name, new.description, new.category, new.code);
END;
CREATE TRIGGER IF NOT EXISTS menu_item_ad AFTER DELETE ON menu_item BEGIN
  INSERT INTO menu_item_fts(menu_item_fts, rowid, name, description, category, code)
    VALUES('delete', old.id, old.name, old.description, old.category, old.code);
END;

-- ───────────────────────────────────────────────────────────
-- "order" (quoted because ORDER is reserved)
-- ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "order" (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id        TEXT    NOT NULL UNIQUE,
  customer_id     TEXT,
  session_id      TEXT,
  channel         TEXT    NOT NULL,
  status          TEXT    NOT NULL DEFAULT 'pending',
  subtotal_cents  INTEGER NOT NULL,
  tax_cents       INTEGER NOT NULL DEFAULT 0,
  discount_cents  INTEGER NOT NULL DEFAULT 0,
  total_cents     INTEGER NOT NULL,
  notes           TEXT,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS order_line (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id          TEXT    NOT NULL,
  menu_item_sku     TEXT    NOT NULL,
  qty               INTEGER NOT NULL CHECK (qty > 0),
  unit_price_cents  INTEGER NOT NULL,
  line_total_cents  INTEGER NOT NULL,
  modifiers_json    TEXT    NOT NULL DEFAULT '{}',
  notes             TEXT,
  FOREIGN KEY (order_id) REFERENCES "order"(order_id) ON DELETE CASCADE,
  FOREIGN KEY (menu_item_sku) REFERENCES menu_item(sku)
);

CREATE INDEX IF NOT EXISTS idx_order_status     ON "order"(status);
CREATE INDEX IF NOT EXISTS idx_order_customer   ON "order"(customer_id, created_at);
CREATE INDEX IF NOT EXISTS idx_order_line_order ON order_line(order_id);

-- ───────────────────────────────────────────────────────────
-- customer (lightweight; full profile in MemGC in Phase 3)
-- ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS customer (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id   TEXT    NOT NULL UNIQUE,
  display_name  TEXT,
  phone         TEXT    UNIQUE,
  email         TEXT,
  loyalty_tier  TEXT    NOT NULL DEFAULT 'regular',
  first_seen    TEXT    NOT NULL DEFAULT (datetime('now')),
  last_seen     TEXT    NOT NULL DEFAULT (datetime('now')),
  total_orders  INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_customer_phone ON customer(phone);

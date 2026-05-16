-- Supplier MCP — suppliers, ingredients, purchase orders, consumption log.

CREATE TABLE IF NOT EXISTS supplier (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id     TEXT    NOT NULL UNIQUE,
  name            TEXT    NOT NULL,
  contact_phone   TEXT,
  contact_email   TEXT,
  lead_time_hours INTEGER NOT NULL DEFAULT 24,
  is_active       INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS ingredient (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  ingredient_id         TEXT    NOT NULL UNIQUE,
  name                  TEXT    NOT NULL,
  unit                  TEXT    NOT NULL,                    -- 'kg' | 'g' | 'unit' | 'liter' | 'ml'
  stock_qty             REAL    NOT NULL DEFAULT 0,
  par_qty               REAL    NOT NULL,
  reorder_qty           REAL    NOT NULL,
  preferred_supplier_id TEXT,
  cost_per_unit_cents   INTEGER NOT NULL DEFAULT 0,
  last_consumed_at      TEXT,
  FOREIGN KEY (preferred_supplier_id) REFERENCES supplier(supplier_id)
);

CREATE TABLE IF NOT EXISTS supplier_order (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_order_id TEXT    NOT NULL UNIQUE,
  supplier_id       TEXT    NOT NULL,
  status            TEXT    NOT NULL DEFAULT 'pending',
  total_cents       INTEGER NOT NULL DEFAULT 0,
  ordered_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  expected_at       TEXT,
  delivered_at      TEXT,
  FOREIGN KEY (supplier_id) REFERENCES supplier(supplier_id)
);

CREATE TABLE IF NOT EXISTS supplier_order_line (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_order_id TEXT    NOT NULL,
  ingredient_id     TEXT    NOT NULL,
  qty               REAL    NOT NULL,
  unit_cost_cents   INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (supplier_order_id) REFERENCES supplier_order(supplier_order_id) ON DELETE CASCADE,
  FOREIGN KEY (ingredient_id)     REFERENCES ingredient(ingredient_id)
);

CREATE TABLE IF NOT EXISTS ingredient_consumption (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id      TEXT    NOT NULL,
  ticket_id     TEXT,
  ingredient_id TEXT    NOT NULL,
  qty           REAL    NOT NULL,
  consumed_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ingredient_par      ON ingredient(stock_qty, par_qty);
CREATE INDEX IF NOT EXISTS idx_consumption_order   ON ingredient_consumption(order_id);

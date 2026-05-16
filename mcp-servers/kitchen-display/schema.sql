-- Kitchen Display MCP — tickets, ticket lines, station state.

CREATE TABLE IF NOT EXISTS ticket (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id   TEXT    NOT NULL UNIQUE,
  order_id    TEXT    NOT NULL,                              -- references pos.db "order"
  station     TEXT    NOT NULL,                              -- 'grill' | 'fry' | 'cold' | 'bev'
  status      TEXT    NOT NULL DEFAULT 'queued',             -- queued|firing|cooking|plated|delivered|cancelled
  priority    INTEGER NOT NULL DEFAULT 0,                    -- higher = sooner (VIP boost)
  fire_at     TEXT,                                          -- ISO timestamp; NULL = immediate
  ready_at    TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ticket_line (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id       TEXT    NOT NULL,
  menu_item_sku   TEXT    NOT NULL,
  menu_item_code  TEXT    NOT NULL,
  menu_item_name  TEXT    NOT NULL,
  qty             INTEGER NOT NULL CHECK (qty > 0),
  modifiers_json  TEXT    NOT NULL DEFAULT '{}',
  status          TEXT    NOT NULL DEFAULT 'pending',
  FOREIGN KEY (ticket_id) REFERENCES ticket(ticket_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS station (
  name           TEXT    PRIMARY KEY,
  queue_depth    INTEGER NOT NULL DEFAULT 0,
  avg_wait_s     INTEGER NOT NULL DEFAULT 180,
  is_overloaded  INTEGER NOT NULL DEFAULT 0,
  updated_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO station(name, avg_wait_s) VALUES
  ('grill', 240), ('fry', 240), ('cold', 90), ('bev', 60);

CREATE INDEX IF NOT EXISTS idx_ticket_status        ON ticket(status);
CREATE INDEX IF NOT EXISTS idx_ticket_station_pri   ON ticket(station, priority DESC, fire_at);
CREATE INDEX IF NOT EXISTS idx_ticket_order         ON ticket(order_id);

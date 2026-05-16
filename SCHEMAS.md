# FeedMe — Schemas & Contracts

> Sister document to `PLAN.md` and `PHASES.md`. Every SQLite table, Kafka event, HTTP route, MCP tool, and memgc-service endpoint that the prototype touches.
>
> **Scope**: single-tenant prototype. All databases are SQLite. Multi-tenant column prefixes (account_id) deliberately omitted.

---

## 1. SQLite databases

Each MCP server owns one SQLite file under `data/`. The file is created on first boot if missing. Schema migrations are inline (single `init()` call at server start; no migration framework yet — prototype scope).

All SQLite databases use **WAL mode** (concurrent reader-friendly) and **synchronous = NORMAL** (durability good enough for prototype, big perf win).

```typescript
// Convention: every MCP server's client.ts starts with:
const db = new Database(DB_PATH);
db.run("PRAGMA journal_mode = WAL");
db.run("PRAGMA synchronous = NORMAL");
db.run("PRAGMA foreign_keys = ON");
db.run(SCHEMA_SQL);   // bun:sqlite handles multi-statement DDL
```

### 1.1 `data/pos.db` — POS MCP

The source-of-truth for menu, orders, customers. **Other MCP servers read this read-only** when they need menu reference data; they don't duplicate.

```sql
-- ───────────────────────────────────────────────────────────
-- menu items (~15-30 rows for prototype)
-- ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS menu_item (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  sku                TEXT    NOT NULL UNIQUE,                  -- 'burger_double_cheese'
  name               TEXT    NOT NULL,                          -- 'Double Cheeseburger'
  description        TEXT,
  price_cents        INTEGER NOT NULL,                          -- in restaurant currency (MYR cents)
  category           TEXT    NOT NULL,                          -- 'mains' | 'sides' | 'drinks' | 'desserts'
  station            TEXT    NOT NULL,                          -- 'grill' | 'fry' | 'cold' | 'bev'
  prep_time_seconds  INTEGER NOT NULL DEFAULT 180,
  allergens_json     TEXT    NOT NULL DEFAULT '[]',             -- ["dairy","gluten"]
  ingredient_ids_json TEXT   NOT NULL DEFAULT '[]',             -- ["beef","cheddar","bun"]
  is_available       INTEGER NOT NULL DEFAULT 1,                -- 0 = 86'd
  image_url          TEXT,
  created_at         TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- FTS5 index for natural-language menu search ("spicy chicken")
CREATE VIRTUAL TABLE IF NOT EXISTS menu_item_fts USING fts5(
  name, description, category,
  content='menu_item', content_rowid='id', tokenize='porter unicode61'
);

-- Triggers to keep FTS index in sync
CREATE TRIGGER IF NOT EXISTS menu_item_ai AFTER INSERT ON menu_item BEGIN
  INSERT INTO menu_item_fts(rowid, name, description, category) VALUES (new.id, new.name, new.description, new.category);
END;
CREATE TRIGGER IF NOT EXISTS menu_item_au AFTER UPDATE ON menu_item BEGIN
  INSERT INTO menu_item_fts(menu_item_fts, rowid, name, description, category) VALUES('delete', old.id, old.name, old.description, old.category);
  INSERT INTO menu_item_fts(rowid, name, description, category) VALUES (new.id, new.name, new.description, new.category);
END;
CREATE TRIGGER IF NOT EXISTS menu_item_ad AFTER DELETE ON menu_item BEGIN
  INSERT INTO menu_item_fts(menu_item_fts, rowid, name, description, category) VALUES('delete', old.id, old.name, old.description, old.category);
END;

-- ───────────────────────────────────────────────────────────
-- orders
-- ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "order" (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id        TEXT    NOT NULL UNIQUE,                     -- ULID, 'ord_01H...'
  customer_id     TEXT,                                          -- nullable for anonymous orders
  session_id      TEXT,                                          -- agent session_id (resume continuity)
  channel         TEXT    NOT NULL,                              -- 'kiosk' | 'mobile' | 'web'
  status          TEXT    NOT NULL DEFAULT 'pending',            -- pending|confirmed|preparing|ready|delivered|cancelled
  subtotal_cents  INTEGER NOT NULL,
  tax_cents       INTEGER NOT NULL DEFAULT 0,
  discount_cents  INTEGER NOT NULL DEFAULT 0,
  total_cents     INTEGER NOT NULL,
  notes           TEXT,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (customer_id) REFERENCES customer(customer_id)
);

CREATE TABLE IF NOT EXISTS order_line (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id          TEXT    NOT NULL,
  menu_item_sku     TEXT    NOT NULL,
  qty               INTEGER NOT NULL CHECK (qty > 0),
  unit_price_cents  INTEGER NOT NULL,
  line_total_cents  INTEGER NOT NULL,
  modifiers_json    TEXT    NOT NULL DEFAULT '{}',              -- {"no_onions": true, "extra_cheese": true}
  notes             TEXT,
  FOREIGN KEY (order_id) REFERENCES "order"(order_id) ON DELETE CASCADE,
  FOREIGN KEY (menu_item_sku) REFERENCES menu_item(sku)
);

CREATE INDEX IF NOT EXISTS idx_order_status     ON "order"(status);
CREATE INDEX IF NOT EXISTS idx_order_customer   ON "order"(customer_id, created_at);
CREATE INDEX IF NOT EXISTS idx_order_line_order ON order_line(order_id);

-- ───────────────────────────────────────────────────────────
-- customers (lightweight — full profile in MemGC)
-- ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS customer (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id   TEXT    NOT NULL UNIQUE,                       -- ULID, 'cust_01H...'
  display_name  TEXT,
  phone         TEXT    UNIQUE,                                 -- E.164 format; used for VIP lookup
  email         TEXT,
  loyalty_tier  TEXT    NOT NULL DEFAULT 'regular',             -- 'regular' | 'vip' | 'premium'
  first_seen    TEXT    NOT NULL DEFAULT (datetime('now')),
  last_seen     TEXT    NOT NULL DEFAULT (datetime('now')),
  total_orders  INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_customer_phone ON customer(phone);

-- ───────────────────────────────────────────────────────────
-- agent session (for SDK resume; mirrors ai_brain pattern)
-- ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS session (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id    TEXT    NOT NULL UNIQUE,
  customer_id   TEXT,
  channel       TEXT,
  last_used_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_session_customer ON session(customer_id, last_used_at);
```

### 1.2 `data/kitchen-display.db` — Kitchen Display MCP

```sql
-- ───────────────────────────────────────────────────────────
-- kitchen tickets (one per order, sometimes split per station)
-- ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ticket (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id      TEXT    NOT NULL UNIQUE,                      -- 'tkt_01H...'
  order_id       TEXT    NOT NULL,                              -- FK refers to pos.db "order"; no cross-DB FK
  station        TEXT    NOT NULL,                              -- 'grill' | 'fry' | 'cold' | 'bev'
  status         TEXT    NOT NULL DEFAULT 'queued',             -- queued|firing|cooking|plated|delivered
  priority       INTEGER NOT NULL DEFAULT 0,                    -- higher = sooner (VIP boost)
  fire_at        TEXT,                                          -- ISO timestamp; NULL = fire immediately
  ready_at       TEXT,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ticket_line (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id       TEXT    NOT NULL,
  menu_item_sku   TEXT    NOT NULL,
  qty             INTEGER NOT NULL CHECK (qty > 0),
  modifiers_json  TEXT    NOT NULL DEFAULT '{}',
  status          TEXT    NOT NULL DEFAULT 'pending',           -- pending|cooking|ready
  FOREIGN KEY (ticket_id) REFERENCES ticket(ticket_id) ON DELETE CASCADE
);

-- Stations have a live queue depth (used by Inventory + customer-facing for wait-time estimates)
CREATE TABLE IF NOT EXISTS station (
  name           TEXT    PRIMARY KEY,                          -- 'grill', 'fry', 'cold', 'bev'
  queue_depth    INTEGER NOT NULL DEFAULT 0,
  avg_wait_s     INTEGER NOT NULL DEFAULT 180,
  is_overloaded  INTEGER NOT NULL DEFAULT 0,
  updated_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO station(name, avg_wait_s) VALUES
  ('grill', 240), ('fry', 180), ('cold', 60), ('bev', 30);

CREATE INDEX IF NOT EXISTS idx_ticket_status      ON ticket(status);
CREATE INDEX IF NOT EXISTS idx_ticket_station_pri ON ticket(station, priority DESC, fire_at);
CREATE INDEX IF NOT EXISTS idx_ticket_order       ON ticket(order_id);
```

### 1.3 `data/payment.db` — Payment MCP

```sql
-- ───────────────────────────────────────────────────────────
-- payment intents (one per order)
-- ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payment_intent (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  intent_id      TEXT    NOT NULL UNIQUE,                      -- 'pi_01H...'
  order_id       TEXT    NOT NULL UNIQUE,                      -- 1:1 with pos.db order
  amount_cents   INTEGER NOT NULL,
  currency       TEXT    NOT NULL DEFAULT 'MYR',
  method         TEXT,                                          -- 'card' | 'ewallet' | 'cash' | 'apple_pay' | 'stub'
  status         TEXT    NOT NULL DEFAULT 'pending',            -- pending|authorized|captured|refunded|failed
  created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  captured_at    TEXT,
  metadata_json  TEXT    NOT NULL DEFAULT '{}'                  -- raw processor response (Stripe etc.)
);

-- ───────────────────────────────────────────────────────────
-- refunds (always LOCKED — manager approval required)
-- ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS refund (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  refund_id            TEXT    NOT NULL UNIQUE,                -- 'ref_01H...'
  payment_intent_id    TEXT    NOT NULL,
  amount_cents         INTEGER NOT NULL,
  reason               TEXT,
  approved_by          TEXT    NOT NULL,                       -- manager user id from /api/approvals
  approved_at          TEXT    NOT NULL,
  status               TEXT    NOT NULL DEFAULT 'pending',     -- pending|succeeded|failed
  created_at           TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (payment_intent_id) REFERENCES payment_intent(intent_id)
);

-- ───────────────────────────────────────────────────────────
-- HITL pending approvals — shared by all 3 agents
-- ───────────────────────────────────────────────────────────
-- (Lives in payment.db because refunds dominate, but used for ALL locked actions)
CREATE TABLE IF NOT EXISTS pending_approval (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  approval_id     TEXT    NOT NULL UNIQUE,                     -- 'apr_01H...'
  agent           TEXT    NOT NULL,                             -- which agent triggered
  tool_name       TEXT    NOT NULL,                             -- 'mcp__payment__refund' etc.
  args_json       TEXT    NOT NULL,
  status          TEXT    NOT NULL DEFAULT 'pending',           -- pending|approved|rejected|expired
  reason          TEXT,
  requested_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  resolved_at     TEXT,
  resolved_by     TEXT,
  expires_at      TEXT    NOT NULL                              -- auto-expire after 10 min
);

CREATE INDEX IF NOT EXISTS idx_pending_status  ON pending_approval(status, requested_at);
CREATE INDEX IF NOT EXISTS idx_pending_expires ON pending_approval(expires_at);
```

### 1.4 `data/supplier.db` — Supplier MCP

```sql
-- ───────────────────────────────────────────────────────────
-- suppliers
-- ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS supplier (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id        TEXT    NOT NULL UNIQUE,                  -- 'sup_meat_co'
  name               TEXT    NOT NULL,
  contact_phone      TEXT,
  contact_email      TEXT,
  lead_time_hours    INTEGER NOT NULL DEFAULT 24,
  is_active          INTEGER NOT NULL DEFAULT 1
);

-- ───────────────────────────────────────────────────────────
-- ingredients (the actual stockroom items)
-- ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ingredient (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  ingredient_id            TEXT    NOT NULL UNIQUE,            -- 'ing_beef_patty'
  name                     TEXT    NOT NULL,
  unit                     TEXT    NOT NULL,                    -- 'kg' | 'g' | 'unit' | 'liter' | 'ml'
  stock_qty                REAL    NOT NULL DEFAULT 0,
  par_qty                  REAL    NOT NULL,                    -- reorder threshold
  reorder_qty              REAL    NOT NULL,                    -- how much to order at a time
  preferred_supplier_id    TEXT,
  cost_per_unit_cents      INTEGER NOT NULL DEFAULT 0,
  last_consumed_at         TEXT,
  FOREIGN KEY (preferred_supplier_id) REFERENCES supplier(supplier_id)
);

-- ───────────────────────────────────────────────────────────
-- supplier orders (purchase orders we send out)
-- ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS supplier_order (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_order_id    TEXT    NOT NULL UNIQUE,
  supplier_id          TEXT    NOT NULL,
  status               TEXT    NOT NULL DEFAULT 'pending',     -- pending|confirmed|shipped|delivered|cancelled
  total_cents          INTEGER NOT NULL DEFAULT 0,
  ordered_at           TEXT    NOT NULL DEFAULT (datetime('now')),
  expected_at          TEXT,
  delivered_at         TEXT,
  FOREIGN KEY (supplier_id) REFERENCES supplier(supplier_id)
);

CREATE TABLE IF NOT EXISTS supplier_order_line (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_order_id    TEXT    NOT NULL,
  ingredient_id        TEXT    NOT NULL,
  qty                  REAL    NOT NULL,
  unit_cost_cents      INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (supplier_order_id) REFERENCES supplier_order(supplier_order_id) ON DELETE CASCADE,
  FOREIGN KEY (ingredient_id)     REFERENCES ingredient(ingredient_id)
);

-- ───────────────────────────────────────────────────────────
-- consumption log (audit trail; published as Kafka event)
-- ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ingredient_consumption (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id        TEXT    NOT NULL,
  ingredient_id   TEXT    NOT NULL,
  qty             REAL    NOT NULL,
  consumed_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ingredient_par      ON ingredient(stock_qty, par_qty);
CREATE INDEX IF NOT EXISTS idx_consumption_order   ON ingredient_consumption(order_id);
CREATE INDEX IF NOT EXISTS idx_consumption_recent  ON ingredient_consumption(consumed_at);
```

### 1.5 `data/memgc.db`

**Managed by MemGC.** Do not edit directly. Schema includes:
- `memory` (content, embedding, status, version, lineage_id, recall_count, last_accessed_at)
- `entity` + `memory_entity` join (entity index for filtered recall)
- `entity_edge` (graph for multi-hop traversal — v0.3.7+)
- sqlite-vec virtual table (cosine similarity)
- FTS5 virtual table (BM25)

See `/Users/carrickcheah/Project/root_ai/memgc/memgc-py/src/memgc/schema.py` (112 lines, authoritative).

Access only via memgc-service HTTP endpoints (§5). Never read/write memgc.db from agent code.

---

## 2. Kafka events

### Topic list (5 topics, auto-created)

| Topic | Publisher | Consumer(s) | Cadence |
|---|---|---|---|
| `order.created` | Customer-facing Agent (via POS MCP) | Kitchen Agent | per order |
| `order.updated` | POS MCP | (TBD — analytics in Phase 5) | per status change |
| `ingredient.consumed` | Kitchen Agent (via Supplier MCP) | Inventory Agent | per cooked item |
| `stock.low` | Inventory Agent | Customer-facing Agent | when ingredient drops below par |
| `ticket.ready` | Kitchen Agent (via KDS MCP) | (TBD — analytics) | per ticket marked ready |

### Wire format

JSON-serialized events with envelope:

```typescript
interface EventEnvelope<T> {
  event_id:   string;           // ULID — for dedup
  event_type: string;           // 'order.created' etc.
  timestamp:  string;           // ISO-8601 UTC
  trace_id?:  string;           // OTel trace correlation
  data:       T;
}
```

### 2.1 `order.created`

```typescript
interface OrderCreatedData {
  order_id:    string;
  customer_id: string | null;
  session_id:  string | null;
  channel:     'kiosk' | 'mobile' | 'web';
  items: Array<{
    menu_item_sku: string;
    qty:           number;
    modifiers?:    Record<string, unknown>;
    notes?:        string;
  }>;
  subtotal_cents:  number;
  total_cents:     number;
}
```

Example:
```json
{
  "event_id":   "01HMABC0001",
  "event_type": "order.created",
  "timestamp":  "2026-05-16T15:23:45.123Z",
  "trace_id":   "abc123...",
  "data": {
    "order_id":    "ord_01HMABC...",
    "customer_id": "cust_sarah_001",
    "session_id":  "sess_01HM...",
    "channel":     "mobile",
    "items": [
      {"menu_item_sku": "burger_double_cheese", "qty": 1},
      {"menu_item_sku": "fries_med", "qty": 1, "modifiers": {"extra_crispy": true}}
    ],
    "subtotal_cents": 1450,
    "total_cents":    1450
  }
}
```

### 2.2 `order.updated`

```typescript
interface OrderUpdatedData {
  order_id:         string;
  previous_status:  string;
  new_status:       'confirmed' | 'preparing' | 'ready' | 'delivered' | 'cancelled';
}
```

### 2.3 `ingredient.consumed`

```typescript
interface IngredientConsumedData {
  order_id:        string;
  ticket_id:       string;
  ingredient_id:   string;
  qty:             number;
  remaining_stock: number;
}
```

### 2.4 `stock.low`

```typescript
interface StockLowData {
  ingredient_id:        string;
  ingredient_name:      string;
  current_stock:        number;
  par_qty:              number;
  affected_skus:        string[];          // menu_item.sku list to auto-86
  reorder_triggered:    boolean;
  supplier_order_id?:   string;            // if auto-reorder fired
}
```

### 2.5 `ticket.ready`

```typescript
interface TicketReadyData {
  ticket_id: string;
  order_id:  string;
  station:   string;
  ready_at:  string;          // ISO-8601
}
```

### Consumer groups

| Consumer | Group ID | Topic | Idempotency |
|---|---|---|---|
| Kitchen Agent | `kitchen-agent` | `order.created` | SET NX `event:{event_id}` TTL 3600 in Redis |
| Inventory Agent | `inventory-agent` | `ingredient.consumed`, `stock.low` | same |
| Customer-facing Agent | `customer-facing-agent` | `stock.low` | same (used to refresh 86 list) |

---

## 3. HTTP API contracts

### 3.1 Bun app — `src/api/*`

Base URL: `http://localhost:8002`

#### `GET /health`

Liveness probe. Returns 200 if process is up.

```json
{ "status": "ok", "service": "feedme-app", "uptime_s": 234 }
```

#### `GET /ready`

Readiness probe. Returns 200 only if all sidecars (Redis, Kafka, memgc-service, 4 MCP servers) reachable.

```json
{
  "status": "ready",
  "checks": {
    "redis": "ok", "kafka": "ok", "memgc": "ok",
    "mcp_pos": "ok", "mcp_kitchen_display": "ok", "mcp_payment": "ok", "mcp_supplier": "ok"
  }
}
```

#### `POST /api/chat` — SSE streaming

Used by the FeedMe Web App (kiosk · mobile · desktop).

**Request**:
```json
{
  "message":     "I want a Double Cheeseburger combo",
  "customer_id": "cust_sarah_001",
  "session_id":  "sess_01H...",
  "channel":     "mobile"
}
```

Fields:
- `message` (required) — user text
- `customer_id` (optional) — if provided, agent loads customer profile from MemGC; if absent, anonymous order flow
- `session_id` (optional) — to resume conversation; if absent, new session created
- `channel` (required) — `'kiosk' | 'mobile' | 'web'`

**Response**: `Content-Type: text/event-stream`

Event sequence:
```
event: session
data: {"session_id":"sess_01HM..."}

event: text
data: {"delta":"Sure, "}

event: tool_call
data: {"id":"tu_01","tool":"mcp__pos__search_menu","input":{"query":"cheeseburger"}}

event: tool_result
data: {"id":"tu_01","result":[{"sku":"burger_double_cheese","name":"Double Cheeseburger","price_cents":1200,"is_available":true}]}

event: text
data: {"delta":"the Double Cheeseburger is RM12.00. Want fries and a drink to make it a combo? "}

event: tool_call
data: {"id":"tu_02","tool":"mcp__pos__create_order","input":{"customer_id":"cust_sarah_001","items":[...]}}

event: tool_result
data: {"id":"tu_02","result":{"order_id":"ord_01HM...","total_cents":1450}}

event: text
data: {"delta":"\nGot it — order ord_01HM is RM14.50 total."}

event: approval_pending
data: {"approval_id":"apr_01H...","tool":"mcp__pos__comp_above_threshold","amount_cents":1500}

event: done
data: {
  "output": "Sure, the Double Cheeseburger ...",
  "session_id": "sess_01HM...",
  "tools_called": ["mcp__pos__search_menu","mcp__pos__create_order"],
  "tokens": {"input": 1234, "output": 89, "cache_read": 950},
  "cost_usd": 0.0078,
  "duration_ms": 2340
}
```

SSE event types:
| Event | Payload | Notes |
|---|---|---|
| `session` | `{session_id}` | First event — gives the client a session to resume |
| `text` | `{delta}` | Streaming text |
| `thinking` | `{tokens, preview}` | Thinking-block summary (debug) |
| `tool_call` | `{id, tool, input}` | Agent invoked a tool |
| `tool_result` | `{id, result, error?}` | Tool returned |
| `approval_pending` | `{approval_id, tool, args}` | HITL gate hit; client should show approval UI |
| `error` | `{message, code}` | Recoverable error |
| `done` | `{output, session_id, tools_called, tokens, cost_usd, duration_ms}` | Final |

#### `POST /api/chat/sync` — non-streaming

Same request body. Returns single JSON response (the `done` payload). Used by tests and Promptfoo.

```json
{
  "output": "Sure, the Double Cheeseburger...",
  "session_id": "sess_01HM...",
  "tools_called": ["mcp__pos__search_menu","mcp__pos__create_order"],
  "tokens": {"input": 1234, "output": 89},
  "cost_usd": 0.0078,
  "duration_ms": 2340,
  "success": true
}
```

#### `POST /api/approvals/:approval_id/approve`

Manager approves a pending HITL action.

```json
{ "approved_by": "manager_alice" }
```

Returns 200 with `{ "status": "approved" }`. The waiting agent loop wakes and the locked tool runs.

#### `POST /api/approvals/:approval_id/reject`

```json
{ "rejected_by": "manager_alice", "reason": "comp too large" }
```

#### `GET /api/approvals?status=pending`

For the manager UI to poll pending approvals.

### 3.2 MCP servers — common contract

All four MCP servers (POS, Kitchen Display, Payment, Supplier) share this shape, taken from `ai_brain/mcp-servers/chat-now/index.ts`:

| Endpoint | Method | Purpose |
|---|---|---|
| `/health` | GET | Liveness — returns `{status, server, port, tools, timestamp}` |
| `/mcp` | POST | JSON-RPC 2.0 — methods: `initialize`, `tools/list`, `tools/call` |
| `/tools/:name` | POST | Direct invocation (bypass JSON-RPC) — for testing |
| `/messages` | POST | Legacy — same as `/mcp` |
| `/sse` | GET | Legacy SSE transport |
| `/` | GET | Server info |

JSON-RPC `tools/call` request:
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "search_menu",
    "arguments": { "query": "burger" }
  }
}
```

Response:
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "content": [{"type": "text", "text": "[{...}, {...}]"}]
  }
}
```

**Tenant header (legacy from `ai_brain`)**: in single-tenant FeedMe we ignore `X-Account-Id` entirely. Server validates the header is absent OR equals the fixed restaurant id (e.g. `"feedme-demo"`). Future multi-tenant migration: re-enable the validator.

---

## 4. MCP tool catalog

16 tools across 4 servers. All inputs validated with zod.

### 4.1 POS MCP (port 4001)

#### `pos.search_menu`
- **Purpose**: natural-language menu search for the customer-facing agent
- **Input**:
  ```typescript
  {
    query?:      string;                                       // free text; empty = list all
    category?:   'mains'|'sides'|'drinks'|'desserts';
    only_available?: boolean;                                  // default true
    limit?:      number;                                       // default 10
  }
  ```
- **Output**:
  ```typescript
  Array<{
    sku: string; name: string; description: string | null;
    price_cents: number; category: string;
    allergens: string[]; is_available: boolean;
    image_url: string | null;
  }>
  ```
- **Implementation**: FTS5 query on `menu_item_fts` when `query` present, else `SELECT … WHERE is_available = 1` filtered by category.

#### `pos.get_order`
- **Input**: `{ order_id: string }`
- **Output**: `{ order: Order; lines: OrderLine[] }`

#### `pos.create_order`
- **Input**:
  ```typescript
  {
    customer_id:  string | null;
    session_id:   string | null;
    channel:      'kiosk'|'mobile'|'web';
    items: Array<{
      sku: string; qty: number;
      modifiers?: Record<string, unknown>;
      notes?: string;
    }>;
    notes?: string;
  }
  ```
- **Output**: `{ order_id: string; subtotal_cents: number; tax_cents: number; total_cents: number }`
- **Side effects**:
  - Validates every SKU exists and `is_available = 1` (rejects with `Tool error: SKU X is 86'd` otherwise)
  - Inserts `order` + `order_line` rows
  - Computes total: `sum(qty * unit_price_cents) + tax`
  - Publishes `order.created` to Kafka (Phase 2+)

#### `pos.update_order_status`
- **Input**: `{ order_id: string; status: 'confirmed'|'preparing'|'ready'|'delivered'|'cancelled' }`
- **Output**: `{ ok: true }`
- **Side effects**: publishes `order.updated`

#### `pos.comp_above_threshold` (LOCKED — Phase 4)
- **Input**: `{ order_id: string; amount_cents: number; reason: string }`
- **LOCKED**: routes through HITL approval before running

---

### 4.2 Kitchen Display MCP (port 4002)

#### `kds.send_ticket`
- **Input**:
  ```typescript
  {
    order_id: string;
    items: Array<{ sku: string; qty: number; modifiers?: Record<string, unknown> }>;
    priority?: number;                  // 0-10; default 0; VIP gets 5+
  }
  ```
- **Output**:
  ```typescript
  {
    ticket_id: string;
    tickets_by_station: Record<string, { ticket_id: string; lines: number; fire_at: string | null }>;
    estimated_ready_at: string;
  }
  ```
- **Implementation**:
  - Reads `menu_item.station` from `pos.db` for each SKU
  - Splits items by station (one ticket per station, all linked to same order_id)
  - Computes fire schedule using `prep_time_seconds` — longest cook starts first
  - Inserts ticket + ticket_line rows

#### `kds.mark_ready`
- **Input**: `{ ticket_id: string }`
- **Output**: `{ ok: true; ready_at: string }`
- **Side effects**: publishes `ticket.ready`, updates station queue depth

#### `kds.expedite`
- **Input**: `{ ticket_id: string; priority_boost?: number }`  (default 10)
- **Output**: `{ new_priority: number }`

#### `kds.get_queue`
- **Input**: `{ station?: string }`
- **Output**:
  ```typescript
  {
    tickets: Array<{ ticket_id, order_id, station, priority, fire_at, age_s }>;
    total_count: number;
    avg_wait_s: number;
    overloaded_stations: string[];
  }
  ```

---

### 4.3 Payment MCP (port 4003)

#### `payment.process_payment`
- **Input**:
  ```typescript
  {
    order_id:     string;
    amount_cents: number;
    method:       'card'|'ewallet'|'cash'|'apple_pay'|'stub';
    metadata?:    Record<string, unknown>;
  }
  ```
- **Output**: `{ intent_id: string; status: 'captured'|'authorized'|'failed' }`
- **Implementation (prototype)**: stub — sets status to `captured` immediately if `method === 'stub'`; for real methods, return `failed` until Phase 5 wires a real processor.

#### `payment.void_payment`
- **Input**: `{ intent_id: string }`
- **Output**: `{ ok: true }`

#### `payment.refund` (LOCKED)
- **Input**: `{ intent_id: string; amount_cents: number; reason: string }`
- **Output**: `{ refund_id: string; status: string }`
- **LOCKED**: HITL approval required (Phase 4)

#### `payment.get_payment`
- **Input**: `{ intent_id: string }` OR `{ order_id: string }`
- **Output**: `PaymentIntent` row

---

### 4.4 Supplier MCP (port 4004)

#### `supplier.list_suppliers`
- **Input**: `{}` or `{ ingredient_id?: string }`
- **Output**: `Array<{ supplier_id, name, lead_time_hours, is_active }>`

#### `supplier.place_order`
- **Input**:
  ```typescript
  {
    supplier_id: string;
    lines: Array<{ ingredient_id: string; qty: number }>;
  }
  ```
- **Output**: `{ supplier_order_id: string; expected_at: string; total_cents: number }`

#### `supplier.get_lead_time`
- **Input**: `{ supplier_id?: string; ingredient_id?: string }`
- **Output**: `{ hours: number }`

#### `supplier.record_ingredient_consumption`
- **Input**: `{ order_id: string; ticket_id: string; consumption: Array<{ ingredient_id: string; qty: number }> }`
- **Output**: `{ low_stock_ingredients: string[] }`
- **Side effects**:
  - Decrements `ingredient.stock_qty` for each line
  - Inserts `ingredient_consumption` audit rows
  - Publishes `ingredient.consumed` per line
  - If `stock_qty < par_qty`, publishes `stock.low` with affected SKUs

#### `supplier.get_ingredient_stock`
- **Input**: `{ ingredient_id?: string }` (omit for all)
- **Output**: `Array<{ ingredient_id, name, stock_qty, par_qty, unit, is_low: boolean }>`

---

## 5. memgc-service HTTP API

Base URL: `http://localhost:8003`

Implemented in `memgc-service/service.py`. Wraps `memgc-py`.

### 5.1 `GET /health`

```json
{
  "status": "ok",
  "service": "memgc-service",
  "memgc_installed": true,
  "data_dir": "/data",
  "data_dir_writable": true
}
```

### 5.2 `POST /open`

Initialize (or re-open) the MemGC instance. Idempotent — called by Bun app on first request.

**Request**: `{}`  (single tenant, no restaurant_id needed)

**Response**:
```json
{ "db_path": "/data/memgc.db", "version": "0.4.0a1", "ready": true }
```

### 5.3 `POST /answer`

Run PRISM agentic retrieval loop. Returns synthesized answer + supporting evidence.

**Request**:
```json
{
  "question": "What does Sarah usually order?",
  "k_pool": 100,
  "n_iterations": 3,
  "n_samples": 7,
  "use_reranker": true
}
```

**Response**:
```json
{
  "text": "Sarah typically orders the Mushroom Swiss combo with extra crispy fries. She has noted 'no onions please' multiple times.",
  "memories": [
    { "id": 142, "speaker": "Sarah", "content": "no onions please", "score": 0.91 },
    { "id": 138, "speaker": "Sarah", "content": "I'll have the Mushroom Swiss combo", "score": 0.87 }
  ],
  "mode": "agentic",
  "elapsed_s": 8.4,
  "tokens": { "input": 5230, "output": 187 }
}
```

**Latency**: 5-15s typical, up to 80s worst case. **Bun app MUST cache results in Redis** (key: `memgc:answer:{sha256(question)}`, TTL 300s).

### 5.4 `POST /extract`

Distill atomic facts from a conversation transcript and write to memory.

**Request**:
```json
{
  "messages": [
    { "speaker": "Sarah",    "text": "I always order the Mushroom Swiss" },
    { "speaker": "Sarah",    "text": "No onions please" },
    { "speaker": "assistant", "text": "Got it, noting that for next time." }
  ],
  "session_date": "2026-05-16"
}
```

**Response**:
```json
{ "new_ids": ["mem_01H...", "mem_02H..."], "deduped": 1 }
```

### 5.5 `POST /consolidate`

Compress a conversation log into a dense YAML AgentState. Never persisted — for system-prompt seeding.

**Request**: same shape as `/extract`

**Response**:
```json
{
  "yaml": "## AgentState\n  customer: Sarah\n  preferences:\n    - no onions\n    - VIP tier\n  active_order: null\n  open_questions: []\n",
  "compression_ratio": 3.4
}
```

### 5.6 `POST /dreaming`

Decay-score every memory and archive cold rows. Pure math, no LLM. Called by nightly cron at 3 AM.

**Request**:
```json
{
  "threshold": 0.05,
  "half_life_days": 90.0,
  "dry_run": false,
  "weights": {
    "frequency": 0.4,
    "recency": 0.3,
    "consolidation": 0.2,
    "conceptual": 0.1
  }
}
```

**Response**:
```json
{
  "scanned":      1002,
  "archived":     104,
  "kept":         898,
  "archived_ids": ["mem_01...","mem_02..."],
  "elapsed_s":    0.04
}
```

### 5.7 Error responses

All endpoints return on error:
```json
{ "detail": "human-readable error", "code": "memgc_load_failed" }
```

with HTTP status 4xx (bad input) or 5xx (internal). Bun client must handle:
- 503 — MemGC not initialized; retry after `/open`
- 504 — PRISM timeout; fall back to single-pass retrieval (no agent loop)

---

## 6. Trace correlation

Every `/api/chat` request gets an OTel trace ID. The trace propagates:
- Through Bun app → Brain → MCP HTTP calls (`X-Trace-Id` header)
- Through Kafka events (`trace_id` field in envelope)
- Through memgc-service calls (`X-Trace-Id` header → `service.py` reads and includes in response)

End result: in Langfuse, you can pull up one trace and see every LLM call, every tool call, every Kafka publish, every MemGC call for a single customer interaction.

---

## 7. Open questions about schemas

(See `QUESTIONS.md §3` for full list. Highlights here.)

- **Should `order` and `customer` live in the same `pos.db`?** Currently yes (joinable). Alternative: separate `crm.db`. Recommend keep together for prototype.
- **JSON columns vs separate tables for modifiers?** Going with JSON (`modifiers_json`) for prototype flexibility. Migration to relational `order_line_modifier` table is straightforward later.
- **ULIDs vs UUIDs vs autoincrement?** Going with ULIDs (`ord_01H...`) — timestamp-sortable, human-skimmable. `ulid` package is already in `package.json`.
- **WAL checkpoint cadence?** SQLite WAL files can grow. Phase 5 adds nightly `PRAGMA wal_checkpoint(TRUNCATE)`.
- **Cross-MCP transactions?** None for prototype. If `order.created` succeeds in POS but Kafka publish fails, we have a leaked row. Accept for prototype; outbox pattern in v1.

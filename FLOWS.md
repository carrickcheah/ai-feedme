# FeedMe — Sequence Diagrams

> ASCII sequence diagrams for the 6 most important request flows.
> Pair with `feedme_agent_architecture_v8.svg` (static layers) and `PHASES.md` (build order).
>
> **Reading hint**: `→` is a synchronous call/await; `⇢` is an async Kafka publish; `◀──` is a response/return.

---

## 1. Anonymous order (happiest path, Phase 1)

A walk-up customer at the kiosk orders a burger. No `customer_id`. No memory lookup.

```
Customer        Web App        Bun :8002         Customer-      POS MCP        SQLite
(kiosk)        (frontend)     (Hono SSE)         facing Agent   :4001          (pos.db)
   │              │              │                 │              │              │
   │ "I want a    │              │                 │              │              │
   │  burger"     │              │                 │              │              │
   │─────────────▶│              │                 │              │              │
   │              │ POST /api/   │                 │              │              │
   │              │ chat (SSE)   │                 │              │              │
   │              │─────────────▶│                 │              │              │
   │              │              │                 │              │              │
   │              │              │ build prompt    │              │              │
   │              │              │ (10 .md files)  │              │              │
   │              │              │────────────────▶│              │              │
   │              │              │                 │              │              │
   │              │              │ session_id      │              │              │
   │              │              │◀────────────────│              │              │
   │              │              │ (SSE: session)  │              │              │
   │              │◀─────────────│                 │              │              │
   │              │              │                 │              │              │
   │              │              │       Brain.runStreaming()     │              │
   │              │              │                 │              │              │
   │              │              │                 │  LLM:  "Let me search..."   │
   │              │              │ (SSE: text Δ)   │              │              │
   │              │◀─────────────│                 │              │              │
   │              │              │                 │              │              │
   │              │              │                 │ tool:search_menu("burger")  │
   │              │              │                 │─────────────▶│              │
   │              │              │                 │              │ FTS5 query   │
   │              │              │                 │              │─────────────▶│
   │              │              │                 │              │◀─────────────│
   │              │              │                 │◀─────────────│              │
   │              │              │                 │   [3 burger items]          │
   │              │              │                 │              │              │
   │              │              │                 │  LLM picks the Double Cheese│
   │              │              │                 │  LLM:  "RM12 — want fries?" │
   │              │              │ (SSE: text)     │              │              │
   │              │◀─────────────│                 │              │              │
   │              │              │                 │              │              │
   │              │              │                 │ tool: create_order(items)   │
   │              │              │                 │─────────────▶│              │
   │              │              │                 │              │ INSERT order │
   │              │              │                 │              │ INSERT lines │
   │              │              │                 │              │─────────────▶│
   │              │              │                 │              │◀─────────────│
   │              │              │                 │              │  order_id    │
   │              │              │                 │◀─────────────│              │
   │              │              │                 │   total=1450 │              │
   │              │              │                 │              │              │
   │              │              │                 │  LLM: "Got it — order      │
   │              │              │                 │   ord_01HM... is RM14.50,  │
   │              │              │                 │   ready in ~5 min"          │
   │              │              │                 │              │              │
   │              │              │ (SSE: done)     │              │              │
   │              │◀─────────────│                 │              │              │
   │              │ render text  │                 │              │              │
   │ "Order        │              │                 │              │              │
   │  confirmed!"  │              │                 │              │              │
   │◀─────────────│              │                 │              │              │
```

**Latency budget** (Phase 1 target): start-to-first-byte <1.5s, full completion <5s. Two LLM rounds + two MCP tool calls.

---

## 2. Returning VIP customer (Phase 3 — uses MemGC)

Sarah opens the Web App. Her `customer_id` is recognized. The agent recalls her preferences before her first message.

```
Customer       Web App      Bun :8002      Customer-      Redis      memgc-        MemGC
(Sarah)       (frontend)    (Hono SSE)     facing Agent   cache      service       (SQLite)
                                                          :6379      :8003         (memgc.db)
   │             │             │              │             │           │             │
   │ "Hi"        │             │              │             │           │             │
   │ (with       │             │              │             │           │             │
   │  customer_id│             │              │             │           │             │
   │  =sarah)    │             │              │             │           │             │
   │────────────▶│             │              │             │           │             │
   │             │ POST /chat  │              │             │           │             │
   │             │────────────▶│              │             │           │             │
   │             │             │              │             │           │             │
   │             │             │ run agent    │             │           │             │
   │             │             │─────────────▶│             │           │             │
   │             │             │              │             │           │             │
   │             │             │              │ Check cache for         │             │
   │             │             │              │ memgc:answer:sha(...)   │             │
   │             │             │              │────────────▶│           │             │
   │             │             │              │             │ MISS      │             │
   │             │             │              │◀────────────│           │             │
   │             │             │              │             │           │             │
   │             │             │              │ POST /answer ──────────▶│             │
   │             │             │              │ {"question":            │             │
   │             │             │              │ "profile of sarah?"}    │             │
   │             │             │              │             │           │             │
   │             │             │              │             │           │ Analyzer    │
   │             │             │              │             │           │────────────▶│
   │             │             │              │             │           │ entity      │
   │             │             │              │             │           │ filter      │
   │             │             │              │             │           │◀────────────│
   │             │             │              │             │           │ vec + BM25  │
   │             │             │              │             │           │ + rerank    │
   │             │             │              │             │           │             │
   │             │             │              │             │           │ Selector ⇔  │
   │             │             │              │             │           │ Adder × 3   │
   │             │             │              │             │           │             │
   │             │             │              │             │           │ Generator   │
   │             │             │              │             │           │ N=7 self-   │
   │             │             │              │             │           │ consist     │
   │             │             │              │             │           │             │
   │             │             │              │             │           │ Verifier    │
   │             │             │              │             │           │             │
   │             │             │              │   ~8s total │           │             │
   │             │             │              │◀────────────│───────────│             │
   │             │             │              │ {text: "VIP, allergic to onions,      │
   │             │             │              │  usual: Mushroom Swiss combo"}        │
   │             │             │              │             │           │             │
   │             │             │              │ SETEX cache │           │             │
   │             │             │              │────────────▶│           │             │
   │             │             │              │  TTL 300s   │           │             │
   │             │             │              │             │           │             │
   │             │             │              │ Compose system prompt with:           │
   │             │             │              │   <memory>{memgc.text}</memory>       │
   │             │             │              │   <skills>{vip_protocol,...}</skills> │
   │             │             │              │   user message: "Hi"                  │
   │             │             │              │             │           │             │
   │             │             │              │ Brain.runSync(...)      │             │
   │             │             │              │   LLM: "Welcome back Sarah! Your      │
   │             │             │              │   usual Mushroom Swiss, no onions?"   │
   │             │             │              │             │           │             │
   │             │             │ done event   │             │           │             │
   │             │ "Welcome    │              │             │           │             │
   │             │ back Sarah!"│              │             │           │             │
   │◀────────────│             │              │             │           │             │
   │             │             │              │ (background, fire-and-forget):        │
   │             │             │              │ POST /extract ─────────▶│             │
   │             │             │              │ {messages: [...this turn...]}         │
   │             │             │              │             │           │             │
   │             │             │              │             │           │ extract     │
   │             │             │              │             │           │ new facts   │
   │             │             │              │             │           │────────────▶│
   │             │             │              │             │           │ INSERT memories
   │             │             │              │             │           │◀────────────│
```

**Key timing**: first time Sarah's profile is fetched, ~8s. **Second time within 5 min, ~50ms (Redis hit).** Most of Sarah's session is the cheap path.

---

## 3. Out-of-stock mid-order (Phase 2 — Kafka chain)

A burst of mushroom-swiss orders depletes mushroom stock. The next customer sees it 86'd. Shows the full 3-agent Kafka chain.

```
Customer       Bun :8002    Customer-    POS MCP   Kafka      Kitchen    Kitchen   Supplier  Inventory
                            facing Agent           (broker)   Consumer    Agent     MCP       Agent
   │              │             │           │        │           │          │         │         │
   │"5x Mushroom  │             │           │        │           │          │         │         │
   │ Swiss please"│             │           │        │           │          │         │         │
   │─────────────▶│             │           │        │           │          │         │         │
   │              │ run agent   │           │        │           │          │         │         │
   │              │────────────▶│           │        │           │          │         │         │
   │              │             │ create_order      │           │          │         │         │
   │              │             │──────────▶│        │           │          │         │         │
   │              │             │◀──────────│        │           │          │         │         │
   │              │             │ order_id  │        │           │          │         │         │
   │              │             │           │        │           │          │         │         │
   │              │             │ publish order.created ⇢⇢⇢⇢⇢⇢⇢⇢│          │         │         │
   │              │             │           │        │           │          │         │         │
   │              │             │ "order placed, 4-5 min wait"   │          │         │         │
   │              │ done        │           │        │           │          │         │         │
   │◀─────────────│             │           │        │           │          │         │         │
   │              │             │           │        │           │          │         │         │
   │              │             │           │        │ deliver to│          │         │         │
   │              │             │           │        │ subscriber│          │         │         │
   │              │             │           │        │──────────▶│          │         │         │
   │              │             │           │        │           │ run agent│         │         │
   │              │             │           │        │           │─────────▶│         │         │
   │              │             │           │        │           │          │ send_ticket(×1)   │
   │              │             │           │        │           │          │ to grill          │
   │              │             │           │        │           │          │  station          │
   │              │             │           │        │           │          │─────────│         │
   │              │             │           │        │           │          │ insert  │         │
   │              │             │           │        │           │          │ ticket  │         │
   │              │             │           │        │           │          │ row     │         │
   │              │             │           │        │           │          │◀─────────         │
   │              │             │           │        │           │          │         │         │
   │              │             │           │        │           │          │ record_ingredient_  │
   │              │             │           │        │           │          │ consumption(beef,  │
   │              │             │           │        │           │          │ cheddar, mushroom) │
   │              │             │           │        │           │          │───────────────────▶│
   │              │             │           │        │           │          │  (Supplier MCP)    │
   │              │             │           │        │           │          │                    │
   │              │             │           │        │           │          │  decrement stock:   │
   │              │             │           │        │           │          │  mushroom 5→0      │
   │              │             │           │        │           │          │                    │
   │              │             │           │        │           │ publish ingredient.consumed ×3│
   │              │             │           │        │◀──────────│          │                    │
   │              │             │           │        │           │          │                    │
   │              │             │           │        │           │          │  mushroom stock=0   │
   │              │             │           │        │           │          │  par=2, so:         │
   │              │             │           │        │           │          │                    │
   │              │             │           │        │           │          │  publish stock.low ⇢│
   │              │             │           │        │◀──────────────────────                    │
   │              │             │           │        │           │          │                    │
   │              │             │           │        │ deliver to│          │         │         │
   │              │             │           │        │ inventory │          │         │         │
   │              │             │           │        │──────────────────────────────────────────▶│
   │              │             │           │        │           │          │         │ run agent│
   │              │             │           │        │           │          │         │ 86 affected SKUs:
   │              │             │           │        │           │          │         │   UPDATE menu_item
   │              │             │           │        │           │          │         │   SET is_available=0
   │              │             │           │        │           │          │         │   WHERE sku IN (...)
   │              │             │           │        │           │          │         │         │
   │              │             │           │        │           │          │         │ place_order(supplier)│
   │              │             │           │        │           │          │         │ ──────────────────────
   │              │             │           │        │           │          │         │   supplier_order row │
                                                                                                  
   ─── 30 seconds later ─── another customer arrives ───
   │              │             │           │        │           │          │         │         │
   │"Mushroom     │             │           │        │           │          │         │         │
   │ Swiss        │             │           │        │           │          │         │         │
   │ please"      │             │           │        │           │          │         │         │
   │─────────────▶│ run agent   │           │        │           │          │         │         │
   │              │────────────▶│ search_menu("mushroom")        │          │         │         │
   │              │             │──────────▶│        │           │          │         │         │
   │              │             │           │ WHERE is_available=1          │         │         │
   │              │             │◀──────────│        │           │          │         │         │
   │              │             │   []      │        │           │          │         │         │
   │              │             │           │        │           │          │         │         │
   │              │             │ "Sorry, we're out of Mushroom Swiss tonight —       │         │
   │              │             │  can I suggest the Bacon Swiss instead?"            │         │
   │              │ done        │           │        │           │          │         │         │
   │◀─────────────│             │           │        │           │          │         │         │
```

**Key**: 86 propagation is **eventually consistent** through Kafka. Window between "stock hit 0" and "menu_item.is_available = 0" is ~3-5 seconds in practice. Acceptable for prototype.

---

## 4. Manager approval flow (Phase 4 — HITL)

Customer asks for a large comp. Agent hits the locked threshold, blocks, manager approves via UI.

```
Customer       Bun :8002      Customer-      pending_       Redis        Manager
                              facing Agent   approval       pub/sub      UI (Web App
                                             (in payment.db)             /manager)
   │             │                │               │            │            │
   │"My order    │                │               │            │            │
   │ was cold —  │                │               │            │            │
   │ comp the    │                │               │            │            │
   │ whole RM45  │                │               │            │            │
   │ please"     │                │               │            │            │
   │────────────▶│ run agent      │               │            │            │
   │             │───────────────▶│               │            │            │
   │             │                │               │            │            │
   │             │                │ LLM: "I'll comp this — but RM45 needs   │
   │             │                │  manager approval, please hold."        │
   │             │                │               │            │            │
   │             │                │ tool: comp_above_threshold(amount=4500) │
   │             │                │               │            │            │
   │             │                │ isLocked(...) │            │            │
   │             │                │ → true (>1000)│            │            │
   │             │                │               │            │            │
   │             │                │ createPendingApproval()    │            │
   │             │                │──────────────▶│            │            │
   │             │                │               │ INSERT     │            │
   │             │                │               │ status=    │            │
   │             │                │               │ 'pending'  │            │
   │             │                │◀──────────────│            │            │
   │             │                │ apr_01H...    │            │            │
   │             │                │               │            │            │
   │             │ SSE: approval_pending          │            │            │
   │             │ {apr_01H..., tool, amount}     │            │            │
   │◀────────────│                │               │            │            │
   │ (UI shows   │                │               │            │            │
   │ "waiting    │                │               │            │            │
   │ for manager")│               │               │            │            │
   │             │                │               │            │            │
   │             │                │ subscribe redis channel approval:apr_01H│
   │             │                │──────────────────────────▶│            │
   │             │                │ (block, await message)    │            │
   │             │                │               │            │            │
   │             │                │               │            │            │ Manager polls
   │             │                │               │            │            │ GET /api/approvals
   │             │                │               │            │            │ ?status=pending
   │             │                │               │ SELECT     │            │
   │             │                │               │◀───────────────────────│
   │             │                │               │ [apr_01H...]
   │             │                │               │            │            │
   │             │                │               │            │            │ Manager taps
   │             │                │               │            │            │ "Approve" button
   │             │                │               │            │            │ in UI:
   │             │                │               │            │            │ POST /api/approvals
   │             │                │               │            │            │ /apr_01H/approve
   │             │                │               │            │            │
   │             │                │               │ UPDATE status='approved'│
   │             │                │               │◀───────────────────────│
   │             │                │               │            │            │
   │             │                │               │            │ PUBLISH    │
   │             │                │               │            │ approval:  │
   │             │                │               │            │ apr_01H... │
   │             │                │               │            │ "approved" │
   │             │                │               │            │◀───────────│
   │             │                │               │            │            │
   │             │                │               │            │ deliver    │
   │             │                │ ◀─────────────────────────│ message    │
   │             │                │ "approved"    │            │            │
   │             │                │               │            │            │
   │             │                │ unblock, run comp_above_threshold()     │
   │             │                │ for real → POS mcp updates order, etc   │
   │             │                │               │            │            │
   │             │                │ LLM: "Thanks for your patience —        │
   │             │                │  the comp has been approved."           │
   │             │ SSE: text       │               │            │            │
   │             │ SSE: done       │               │            │            │
   │◀────────────│                 │               │            │            │
```

**Timeout**: 10-min default. If manager doesn't respond, agent gets `expired`, returns synthetic tool error: "Manager unavailable, please contact us directly." Customer's session ends gracefully.

---

## 5. Nightly memory dreaming cron (Phase 3 + 5)

At 3 AM local time, MemGC archives cold memories.

```
Cron Scheduler     memgc-client.ts      memgc-service     MemGC          SQLite
(Croner)           (HTTP wrapper)        :8003            (PRISM-loop)    (memgc.db)
   │                  │                    │                │              │
   │ 3:00 AM tick     │                    │                │              │
   │ (Asia/KL)        │                    │                │              │
   │ runDreaming()    │                    │                │              │
   │─────────────────▶│                    │                │              │
   │                  │ POST /dreaming     │                │              │
   │                  │ {threshold:0.05}   │                │              │
   │                  │───────────────────▶│                │              │
   │                  │                    │ mc.dreaming()  │              │
   │                  │                    │───────────────▶│              │
   │                  │                    │                │ SELECT every │
   │                  │                    │                │ active memory│
   │                  │                    │                │─────────────▶│
   │                  │                    │                │  ~1000 rows  │
   │                  │                    │                │◀─────────────│
   │                  │                    │                │              │
   │                  │                    │                │ For each row:│
   │                  │                    │                │  compute     │
   │                  │                    │                │  score =     │
   │                  │                    │                │  0.4*freq +  │
   │                  │                    │                │  0.3*recency │
   │                  │                    │                │  + 0.2*v + ..│
   │                  │                    │                │              │
   │                  │                    │                │ rows < 0.05  │
   │                  │                    │                │ → archive    │
   │                  │                    │                │              │
   │                  │                    │                │ UPDATE memory│
   │                  │                    │                │ SET status=  │
   │                  │                    │                │ 'archived'   │
   │                  │                    │                │ WHERE id IN..│
   │                  │                    │                │─────────────▶│
   │                  │                    │                │◀─────────────│
   │                  │                    │                │              │
   │                  │                    │ DreamStats     │              │
   │                  │                    │ (scanned=1002, │              │
   │                  │                    │  archived=104, │              │
   │                  │                    │  kept=898)     │              │
   │                  │                    │◀───────────────│              │
   │                  │                    │                │              │
   │                  │ 200 OK             │                │              │
   │                  │ {scanned,...}      │                │              │
   │                  │◀───────────────────│                │              │
   │                  │                    │                │              │
   │ log + emit       │                    │                │              │
   │ Prometheus metric│                    │                │              │
   │◀─────────────────│                    │                │              │
```

**Pure math, no LLM call** — runs in <1s for 10k memories. Cheap.

---

## 6. MemGC profile prefetch + extract write (Phase 3)

The before-turn + after-turn hooks in `agent-base.ts`. Shows when MemGC is read vs written.

```
Bun :8002         Customer-      Redis        memgc-service       MemGC
                  facing Agent   cache        :8003               (SQLite)
   │                 │             │             │                  │
   │ /api/chat       │             │             │                  │
   │ "I'll have      │             │             │                  │
   │ Mushroom Swiss  │             │             │                  │
   │ no onions"      │             │             │                  │
   │ customer_id=    │             │             │                  │
   │ sarah           │             │             │                  │
   │────────────────▶│             │             │                  │
   │                 │             │             │                  │
   │                 │ ─── BEFORE TURN ───        │                  │
   │                 │             │             │                  │
   │                 │ Q = sha256("profile of sarah")               │
   │                 │ GET memgc:answer:Q          │                 │
   │                 │────────────▶│             │                  │
   │                 │◀────────────│             │                  │
   │                 │  miss       │             │                  │
   │                 │             │             │                  │
   │                 │ POST /answer ─────────────▶│                  │
   │                 │ (PRISM, ~8s)│             │                  │
   │                 │             │             │                  │
   │                 │             │             │ ...PRISM loop... │
   │                 │             │             │ (see flow §5     │
   │                 │             │             │  fragment, but   │
   │                 │             │             │  with LLM calls) │
   │                 │             │             │                  │
   │                 │◀────────────────────────  │                  │
   │                 │ {text: "VIP, allergic to onions, ..."}        │
   │                 │             │             │                  │
   │                 │ SETEX cache TTL 300s      │                  │
   │                 │────────────▶│             │                  │
   │                 │             │             │                  │
   │                 │ ─── MAIN TURN ───         │                  │
   │                 │             │             │                  │
   │                 │ Compose prompt:            │                  │
   │                 │ <memory>{memgc.text}</memory>                 │
   │                 │ <skills>{vip,allergen}</skills>               │
   │                 │ <user>I'll have Mushroom Swiss no onions</user>│
   │                 │             │             │                  │
   │                 │ Brain.runSync()           │                  │
   │                 │  LLM:                     │                  │
   │                 │  - calls allergen_check skill (load_skill)    │
   │                 │  - calls pos.search_menu  │                  │
   │                 │  - calls pos.create_order with modifier      │
   │                 │  - replies "Got it Sarah, no onions"          │
   │                 │             │             │                  │
   │                 │ ─── AFTER TURN ───        │                  │
   │                 │             │             │                  │
   │                 │ if (had create_order tool call):              │
   │                 │   POST /extract ──────────▶│                  │
   │                 │   {messages: [             │                  │
   │                 │     {speaker:"sarah", text:"no onions please"},│
   │                 │     {speaker:"assistant", text:"got it"}      │
   │                 │   ]}        │             │                  │
   │                 │             │             │                  │
   │                 │             │             │ extract atomic   │
   │                 │             │             │ facts (1 LLM call)│
   │                 │             │             │  → "sarah dislikes onions"
   │                 │             │             │  → "sarah ordered  │
   │                 │             │             │     mushroom swiss"│
   │                 │             │             │                  │
   │                 │             │             │ SHA-1 dedup      │
   │                 │             │             │ vs existing rows │
   │                 │             │             │─────────────────▶│
   │                 │             │             │ INSERT new rows  │
   │                 │             │             │◀─────────────────│
   │                 │             │             │                  │
   │                 │  (no need to wait for extract — fire-and-forget)
   │                 │                                              │
   │ done event      │                                              │
   │◀────────────────│                                              │
```

**Critical design choice**: `extract()` runs async (don't block the customer-facing response). The next customer's `answer()` call benefits from the new facts via cache miss.

---

## Notes on async vs sync

| Operation | Sync (blocks turn) | Async (fire-and-forget) |
|---|---|---|
| `memgc.answer()` profile fetch | ✅ Sync — needed for system prompt | |
| MCP tool calls | ✅ Sync — agent waits for tool result | |
| Kafka `publish*()` | | ✅ Async — agent doesn't wait |
| `memgc.extract()` | | ✅ Async — runs after `done` event |
| `memgc.dreaming()` | | ✅ Cron — never blocks request path |
| `memgc.consolidate()` | | ✅ End-of-session, background |
| HITL `waitForApprovalResolution` | ✅ Sync — agent blocks turn | |

---

## End-to-end trace correlation (Phase 3+)

Every request gets a `trace_id` propagated through:

```
Bun /api/chat receives request
   │
   ├── creates OTel root span "chat.request" (trace_id=abc)
   │
   ├── span "memgc.answer" (parent trace_id=abc)
   │   └── HTTP POST /answer with header X-Trace-Id: abc
   │       └── memgc-service logs trace_id=abc on every span
   │
   ├── span "brain.run" (parent trace_id=abc)
   │   ├── span "anthropic.messages.create" (LLM call 1)
   │   ├── span "mcp.search_menu" → HTTP POST /mcp X-Trace-Id: abc
   │   │   └── pos MCP logs trace_id=abc
   │   ├── span "anthropic.messages.create" (LLM call 2)
   │   ├── span "mcp.create_order" → HTTP POST /mcp X-Trace-Id: abc
   │   │   └── pos MCP publishes order.created with envelope.trace_id=abc
   │   │       └── kitchen consumer reads, runs kitchen agent (parent=abc)
   │   │           └── chain continues...
   │
   └── span "memgc.extract" (parent trace_id=abc)

→ In Langfuse, search by trace_id=abc → see EVERY LLM call, EVERY tool, EVERY Kafka publish, EVERY MemGC call for that single customer interaction.
```

That's the observability promise. One trace ID, full visibility, every service.

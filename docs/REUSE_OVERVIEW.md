# FeedMe — Reuse Map & Build Order

> **Goal**: build an autonomous restaurant AI system without writing from zero. Three projects already provide ~80% of what's needed.
> **Strategy**: lift the closest match (`ai-contact-bun/ai_brain`), supplement with patterns from `ai-agents`, plug `memgc` in as the memory layer.

---

## The 3 sources at a glance

| Project | Closest analogy | Maturity | What FeedMe takes |
|---|---|---|---|
| **`ai-contact-bun/ai_brain`** | E-commerce contact-centre — most similar use case to FeedMe | Production, ~155 evals, 10 channels | **The scaffold.** Supervisor pattern, MCP servers, Skills, Promptfoo, HITL, Brain, observability stack |
| **`ai-agents`** | Multi-tenant personal-agent SaaS | Phases 0-10 shipped, 75 tests | **The architectural patterns.** Filesystem-first context (8 .md files per agent), channel adapters, scheduler, memory compactor, hybrid search |
| **`memgc`** | The memory library | v0.4.0a1, 42 tests | **The memory backbone.** Pip install, point at SQLite per restaurant, call `answer()` and `extract()` |

---

## What FeedMe actually needs to build vs reuse

FeedMe = autonomous restaurant operations system with **3 specialized agents** (Customer-facing, Kitchen, Inventory), event-driven coordination, and memory shared with REMY (the existing BI agent).

| FeedMe component | Source | Lift | Adapt | Build new |
|---|---|---|---|---|
| **HTTP server (Bun + Hono)** | ai_brain `src/index.ts` | ✅ | minor route changes | — |
| **OpenTelemetry init** | ai_brain `src/instrumentation.ts` | ✅ | — | — |
| **Brain LLM router (multi-provider)** | ai_brain `src/brain/` (or ai-agents) | ✅ | drop unused providers | — |
| **Supervisor agent loop** | ai_brain `src/agents/supervisor.ts` | fork ×3 | per-agent prompts & MCP set | — |
| **MCP server template** | ai_brain `mcp-servers/chat-now/index.ts` | ✅ | — | — |
| **POS MCP** | (template + ai_brain `easystore/`) | template | swap schema | content (POS calls) |
| **Kitchen Display MCP** | (template) | template | — | content (KDS calls) |
| **Payment MCP** | (template + ai_brain `easystore/checkout`) | template | — | content (Stripe/local) |
| **Supplier MCP** | (template) | template | — | content (supplier API) |
| **Skills directory** | ai_brain `.claude/skills/` | structure + 3-4 skills | rename/adapt 5 | write restaurant-specific 5-10 |
| **Promptfoo evals** | ai_brain `promptfooconfig.yaml` + `evals/` | ✅ structure | new test scenarios | golden-set scenarios |
| **Resilience / circuit breakers** | ai_brain `src/lib/resilience/` | ✅ | — | — |
| **Observability dashboard** | ai_brain `src/lib/observability/` + `grafana/` | ✅ | — | — |
| **HITL approval flow** | ai_brain `LOCKED_REVIEW_ACTIONS` | ✅ | restaurant-specific locked actions | — |
| **Credit/billing path** | ai_brain `services/credit-gate.ts` | ✅ | — | — |
| **Filesystem context model** | ai-agents `agents/src/context/` + `context-defaults/` | ✅ | 8 → 10 files (add MENU, OPERATIONS) | content per agent |
| **Channel adapters (WhatsApp/Telegram/web)** | ai-agents `agents/src/messaging/` + `whatsapp-web/` | ✅ | — | — |
| **Per-tenant scheduler (cron)** | ai-agents `agents/src/cron/` + `scheduler/` | ✅ | — | nightly tasks |
| **MEMORY.md compactor** | ai-agents `memory-compactor/compactor.ts` | ✅ | — | — |
| **Hybrid search (RRF)** | ai-agents `agents/src/search/` | ✅ | — | menu RAG content |
| **Heartbeat writer** | ai-agents `heartbeat/writer.ts` | ✅ | restaurant operational state schema | — |
| **Memory backbone (working/short/episodic/semantic)** | `memgc` | ✅ | wrap in HTTP service | — |
| **Skills (procedural memory)** | structure from ai_brain | structure | — | upsell.md, vip_protocol.md, 86_item_protocol.md, allergen_check.md, comp_drink.md, complaint_handle.md |
| **Event bus (Kafka)** | — | — | — | **Build new** |
| **Frontend FeedMe App** | — | — | — | **Build new** (or integrate existing) |

**Net result**: only Kafka, the frontend, and ~5 domain-specific skills are net-new.

---

## Mapping reused pieces to FeedMe's 3 agents

```
                         ┌────────────────────────────────────┐
                         │       FeedMe App (frontend)        │
                         │   Kiosk · Mobile · Web · WhatsApp  │
                         └─────────────────┬──────────────────┘
                                           │ SSE / webhooks
                                           ▼
                ┌────────────────────────────────────────────────┐
                │      Hono Server (Bun) — port 8002             │
                │      [from ai_brain/src/index.ts]              │
                └──┬──────────────────────┬──────────────────┬───┘
                   │                      │                  │
   ┌───────────────▼──────────────┐ ┌─────▼───────┐ ┌────────▼────────┐
   │  Customer-facing Agent       │ │  Kitchen    │ │  Inventory      │
   │  [fork of supervisor.ts]     │ │  Agent      │ │  Agent          │
   │  + context files             │ │  [fork]     │ │  [fork]         │
   │  [from ai-agents/context]    │ │             │ │                 │
   └────┬────────────────┬────────┘ └──────┬──────┘ └────────┬────────┘
        │ MCP HTTP       │ memgc          │                  │
        │ JSON-RPC       │ HTTP           │                  │
        ▼                ▼                ▼                  ▼
  ┌─────────────────────────┐  ┌────────────────────────────────────┐
  │   MCP servers           │  │   Event Bus (Kafka)                │
  │   [from chat-now tpl]   │  │   order.created · stock.low · ...  │
  ├─────────────────────────┤  │   [new build]                      │
  │ POS · KDS · Pay · Supp  │  └────────────────────────────────────┘
  │ chat-now · admin-reports│
  └─────────────────────────┘

  ┌─────────────────────────────────────────────────────────────────┐
  │  Memory: MemGC (Python lib, wrapped in FastAPI service)         │
  │  [from memgc/memgc-py]                                          │
  │  ↳ Per-restaurant SQLite at /data/feedme/{rid}/memgc.db          │
  │  ↳ answer() · extract() · consolidate() · dreaming()             │
  │  ↳ Redis cache in front (TTL 5min)                              │
  └─────────────────────────────────────────────────────────────────┘

  ┌──────────────────────────┐ ┌─────────────────────────────────────┐
  │  Skills (procedural)     │ │  Observability                       │
  │  upsell.md · vip.md      │ │  OpenTelemetry → Grafana/Tempo/Prom  │
  │  [structure from         │ │  Promptfoo CI evals                  │
  │   ai_brain/.claude/skills]│ │  [from ai_brain/grafana,prometheus] │
  └──────────────────────────┘ └─────────────────────────────────────┘
```

### Customer-facing Agent — what gets pulled in

- **Code**: forked `ai_brain/src/agents/supervisor.ts` → `src/agents/customer-facing.ts`
- **MCP servers it can call**: POS (read/write), chat-now (read/write), payment (write)
- **Skills loaded**: upsell, search_menu, allergen_check, vip_protocol, complaint_handle, escalate_human, search_knowledge
- **Context files** (in `/data/feedme/{rid}/customer-facing/`): IDENTITY.md, TONE.md, OWNER.md, AGENTS.md, TOOLS.md, HEARTBEAT.md, MEMORY.md, BOOTSTRAP.md, MENU.md
- **Memory**: every turn ends with `memgc.extract(turnTranscript)`. Every turn starts with `memgc.answer("profile of {customer_id}")` (cached in Redis 5min)
- **LOCKED_REVIEW_ACTIONS**: `mcp__pos__void_completed_order`, `mcp__payment__issue_refund_full`, `mcp__pos__comp_above_threshold`

### Kitchen Agent — what gets pulled in

- **Code**: forked supervisor → `src/agents/kitchen.ts`
- **MCP servers**: POS (read), KDS (write), supplier (read for low-stock warnings)
- **Skills loaded**: sequencing, fire_ticket, expedite_vip, mark_86, station_routing
- **Context files**: same shape + OPERATIONS.md (station map, cook times)
- **Memory**: lighter usage. Mostly publishes events. Calls `memgc.answer()` only for kitchen-specific knowledge ("standard prep time for Mushroom Swiss")
- **Trigger**: subscribes to Kafka `order.created` — not a webhook
- **LOCKED_REVIEW_ACTIONS**: none (kitchen actions are routine)

### Inventory Agent — what gets pulled in

- **Code**: forked supervisor → `src/agents/inventory.ts` (cheaper LLM — Haiku-class)
- **MCP servers**: POS (read), supplier (write — reorder), KDS (read for ingredient consumption)
- **Skills loaded**: stock_threshold, reorder_logic, 86_decision, supplier_pick
- **Context files**: same shape + INVENTORY.md (current par levels, suppliers, lead times)
- **Memory**: queries `memgc.answer()` for supplier history, customer demand patterns. Writes via `memgc.extract()` on stock events
- **Trigger**: subscribes to Kafka `ingredient.consumed` and runs nightly cron for reorder
- **LOCKED_REVIEW_ACTIONS**: `mcp__supplier__reorder_above_$X_threshold` (manager approval for large orders)

---

## Build order (4 sprints)

### Sprint 1 — scaffolding & one agent (week 1-2)

**Goal**: customer-facing agent answers a single test order end-to-end.

1. `bun init` FeedMe project
2. Copy from `ai_brain/`:
   - `package.json` (deps, drop financial libs)
   - `src/index.ts` → adapt routes (start with `/api/chat`, `/health`)
   - `src/instrumentation.ts`
   - `src/brain/` (LLM router)
   - `src/lib/` (logger, tracing, resilience, observability, shutdown)
   - `src/config/` + `src/middleware/`
   - `src/services/` (redis-dedup, credit-gate, token-recorder)
3. Copy from `ai-agents/`:
   - `agents/src/context/` (loader + prompt-builder)
   - `agents/context-defaults/` → rename to `context-defaults/customer-facing/`
   - Strip context defaults down to FeedMe-relevant content
4. Fork `ai_brain/src/agents/supervisor.ts` → `src/agents/customer-facing.ts`. Strip everything not needed (assistant-agent, copilot routes).
5. Copy MCP server template `mcp-servers/chat-now/index.ts` → `mcp-servers/pos/index.ts`. Implement 4 tools: `search_menu`, `get_order`, `create_order`, `update_order_status`.
6. Wire MemGC: stand up the FastAPI wrapper. Mount at `${MEMGC_URL}`. Customer-facing agent calls `POST /answer` and `POST /extract`.
7. **Test**: kiosk-like CLI sends "I want a burger" → agent loads context + skill + memory → calls `pos.search_menu` and `pos.create_order` → returns confirmation. Promptfoo eval on this flow.

**Output**: a single working agent on port 8002, hitting one MCP server, with persistent memory across orders.

### Sprint 2 — three agents talking via Kafka (week 3-4)

8. Stand up Kafka (or Redis Streams for simpler start) via docker-compose
9. Fork supervisor twice more: `kitchen.ts` + `inventory.ts`
10. Build Kafka producer in customer-facing agent: `publishOrderCreated({order_id, items, customer_id})`
11. Build Kafka consumer in kitchen + inventory: each subscribes to relevant topics
12. Add MCP servers: `mcp-servers/kitchen-display/` (4 tools), `mcp-servers/supplier/` (4 tools)
13. Per-agent context-files (`customer-facing/`, `kitchen/`, `inventory/` subdirectories under `/data/feedme/{rid}/`)
14. End-to-end test: order placed → customer-facing agent confirms → publishes order.created → kitchen agent sequences cook → inventory agent decrements stock → if stock low, kitchen agent sees 86'd item on next ticket

**Output**: three-agent dance working on one restaurant, one channel (web kiosk).

### Sprint 3 — channels, skills, observability (week 5-6)

15. Copy `ai-agents/agents/src/messaging/` (WhatsApp Web, Telegram) + `whatsapp-web/`
16. Webhook routes from `ai_brain/src/api/webhooks/`: WA, Telegram, web kiosk
17. Build out skills directory — copy structure from `ai_brain/.claude/skills/`, write 5-7 restaurant-specific:
    - `upsell.md`, `vip_protocol.md`, `allergen_check.md`, `86_item_protocol.md`, `comp_drink.md`, `complaint_handle.md`, `escalate_human.md`
18. Copy `ai_brain/grafana/`, `prometheus/`, `tempo/` → adapt dashboards for FeedMe metrics
19. Per-tenant credit/billing wiring (drop in `services/credit-gate.ts`)
20. Promptfoo: copy `promptfooconfig.yaml` + `evals/` shell → write 30+ FeedMe golden-set scenarios

**Output**: multi-channel FeedMe with skills, real observability, and CI eval gate.

### Sprint 4 — operational rigour (week 7-8)

21. Cron scheduler from ai-agents: nightly `mc.dreaming()`, daily owner summary, hourly cart expiry
22. Memory compactor from ai-agents (even with MemGC, the per-restaurant `MEMORY.md` for high-priority facts gets compacted nightly)
23. Heartbeat writer — every 5 min, update `HEARTBEAT.md` per agent (kitchen queue, 86'd items, current sales)
24. Resilience: circuit breaker on every MCP server + Kafka + MemGC
25. HITL: implement `LOCKED_REVIEW_ACTIONS` flow with approval UI (or Slack/WA escalation)
26. Multi-restaurant deployment: per-restaurant data isolation under `/data/feedme/{rid}/`, per-restaurant Kafka topic partitions, per-restaurant MemGC SQLite file

**Output**: production-ready multi-restaurant FeedMe.

---

## Things to NOT do (saving you from common mistakes)

1. **Don't keep ai_brain's `chat_now` PostgreSQL dependency.** It exists because that project federates with a separate chat_now app. For FeedMe, build a local table for conversation memory or push into MemGC. Don't pull in chat_now's whole schema.

2. **Don't use ai-agents' `bash` + `clawagen` 2-tool architecture for FeedMe.** It saves prompt tokens but loses MCP auditability. Restaurant operations need explicit named tools for compliance and HITL.

3. **Don't run ai-agents' Docker sandbox.** Restaurant agents don't need shell access — MCP tools cover everything. Drop the sandbox layer entirely.

4. **Don't sync skills via HTTP (`ai_brain` pattern lines 113-134 of supervisor.ts).** That was a tenant_files service indirection. FeedMe MVP can load skills from local filesystem directly.

5. **Don't write a fresh memory layer.** Use MemGC. Don't reinvent decay, dedup, audit trails.

6. **Don't share one MemGC instance across all restaurants.** Per-restaurant SQLite. Tenant isolation is non-negotiable.

7. **Don't fork supervisor.ts three times without first extracting a shared base.** Refactor into `agent-base.ts` with the message-loop helpers, then three thin per-agent files. Saves triple maintenance.

8. **Don't skip Promptfoo before shipping.** ai_brain has 155 tests — that's the eval bar. FeedMe should reach similar coverage before going live.

9. **Don't wire Langfuse and Grafana both.** Pick one. ai_brain migrated from Langfuse → OTLP+Grafana. Follow the migration: OTLP → Grafana/Tempo. Langfuse is fine as an alternative but don't run both.

10. **Don't try to make the orchestrator (supervisor that routes between agents) work for MVP.** The Customer-facing agent IS the entry, publishes to Kafka, kitchen + inventory subscribe. An orchestrator only earns its keep when you need cross-agent transactions, multi-language routing, FAQs vs orders dispatch.

---

## Reading order if you want to deep-dive

1. **Start here**: ai_brain README + supervisor.ts (757 lines)
2. **Then**: MCP server template — chat-now/index.ts (328 lines) and tools.ts (truncated to 80 lines but you can see the contract)
3. **Then**: ai-agents README §"Agent Brain: How Context Flows" + `agents/src/context/prompt-builder.ts`
4. **Then**: memgc README + `memgc-py/src/memgc/memgc.py` (299 lines) + glance at `agent/prism.py` (1183 lines)
5. **Then**: ai_brain `promptfooconfig.yaml` + one eval file under `evals/wohoo-pet-treats/`

Total: ~3-4 hours of careful reading gets you the whole picture.

---

## Open questions for the next brainstorm

1. **TypeScript or Python for the FeedMe backbone?** ai-agents and ai_brain are both Bun/TS. MemGC is Python. Three options:
   - (a) Bun frontend + supervisor TS, Python sidecar for MemGC (HTTP bridge) ← **default recommendation**
   - (b) All Python (port the supervisor pattern) ← more work but cleaner
   - (c) Polyglot — agents in TS, memgc-service in Python, communicate via gRPC ← over-engineered for MVP

2. **Event bus**: Kafka, Redis Streams, or NATS JetStream? Kafka has best durability; Redis Streams is in-process; NATS is lightweight.

3. **Per-restaurant Postgres or shared Postgres with row-level security?** ai-agents uses per-tenant SQLite. ai_brain uses shared Postgres with `X-Account-Id` everywhere. FeedMe's choice affects backup strategy, scaling ceiling, and tenant-isolation guarantees.

4. **REMY integration**: REMY today reads from FeedMe's existing data. Should the new agents write to MemGC AND to REMY's data store? Or read REMY's data through MemGC as semantic memories?

5. **WhatsApp ordering vs in-store kiosk**: which channel ships first? Kiosk is simpler (no auth flow). WhatsApp drives volume but adds Baileys complexity.

6. **Chain-level vs per-outlet memory**: a chain has 50 restaurants. Does Sarah's VIP status follow her across all 50, or is it per-outlet? Affects whether MemGC is per-restaurant or per-chain.

Bring these to the brainstorm.

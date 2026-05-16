# FeedMe — Build Plan (v3, master index)

> **Target architecture**: `feedme_agent_architecture_v8.svg` — every box mapped to a phase below.
> **Strategy**: lift code from `ai-contact-bun/ai_brain` (most), `ai-agents` (patterns), `memgc` (memory layer).
> **Scope**: **prototype · single tenant · SQLite everywhere · web/mobile responsive only**.

---

## Document map

### Core plan (read in order)

| Doc | Purpose | When to read |
|---|---|---|
| **PLAN.md** *(this file)* | Master index, decisions, status, traceability | First — orients you |
| **PHASES.md** | Per-phase deliverables: lift inventory, new code, done-when, demo scripts | When starting a phase |
| **SCHEMAS.md** | SQLite tables, Kafka events, HTTP APIs, MCP tool catalog | When implementing data/contracts |
| **FLOWS.md** | ASCII sequence diagrams for 6 key flows (anonymous order, VIP, out-of-stock, HITL, dreaming cron, MemGC profile) | When you need to see the request path end-to-end |
| **QUESTIONS.md** | Open questions for review — pick answers, then we proceed | At review checkpoints |

### Domain content templates (fill in to ship)

| Doc | Purpose | When to use |
|---|---|---|
| **CONTEXT_TEMPLATES.md** | Starter content for 30 context `.md` files (10 per agent × 3 agents) | Phase 1 (customer-facing) + Phase 2 (kitchen, inventory) |
| **SKILL_TEMPLATES.md** | Full draft bodies for 5 procedural skills (upsell, vip_protocol, handle_complaint, allergen_check, 86_item_protocol) | Phase 3 |
| **EVAL_SCENARIOS.md** | 30 Promptfoo tests with vars + assertions (10 happy + 10 edge + 5 red team + 5 multi-turn) | Phase 4 |

### Reuse maps (lift from existing code)

| Doc | Purpose | When to read |
|---|---|---|
| **REUSE_AI_AGENTS.md** | File-by-file map of what to lift from `ai-agents` | Phase 1 + Phase 3 + Phase 5 lift |
| **REUSE_AI_CONTACT_BUN.md** | File-by-file map of `ai_brain` (closest match — most lift) | Phase 1, 2, 4 lift |
| **REUSE_MEMGC.md** | MemGC public API + integration shape | Phase 3 wiring |
| **REUSE_OVERVIEW.md** | Synthesis tying all three lift maps together | Cross-phase context |

---

## Locked decisions

| Decision | Choice | Source |
|---|---|---|
| **TS ↔ MemGC bridge** | Python FastAPI sidecar at `memgc-service/`, HTTP JSON | User-confirmed |
| **Event bus** | Real Kafka from day 1 (KRaft mode, single node) | User-confirmed |
| **DB** | **SQLite everywhere** — MemGC + each MCP server has its own file in `data/` | User-confirmed |
| **Frontend** | **EXISTS** at `snow-dessert/` — React + Babel standalone (no build step), iOS-frame mobile UI, ~50 menu items already designed. We add `/api/chat` overlay; no new frontend needed. | User-confirmed |
| **Tenancy** | **Single tenant** — one restaurant, no per-tenant isolation | User-confirmed |
| **Restaurant** | **IceYoo Desaru** — Korean shaved-ice/dessert + Korean chicken + noodles, Desaru (Johor MY) | User-confirmed Q0.1-Q0.4 |
| **Currency** | **RM** (Malaysian Ringgit) | User-confirmed |
| **Timezone** | **Asia/Kuala_Lumpur** | User-confirmed |
| **Tax / SST** | **Ignored for prototype** — no tax computation, no SST line item | User-confirmed Q2.4 |
| **Primary LLM** | **Azure OpenAI `gpt-5.5`** (Global Standard deployment) at `https://bbbbbjhgrehhg.cognitiveservices.azure.com/`. Key in `z_API/API/AZURE_5-5.md`. Uses `max_completion_tokens`, no custom temperature, supports `reasoning_effort`. | User-confirmed Q1.6 (revised from DeepSeek) |
| **Inventory agent LLM** | Same `gpt-5.5` model with `reasoning_effort: "none"` (or `"low"`) — simpler work, cheaper call | Single deployment for all agents |
| **Fallback LLM** | None for prototype (Azure-only) | Smoke-tested 2026-05-16: 3.6s @ $0.00143/turn for menu inquiry |
| **MemGC LLM** | Azure `gpt-5.5` (unified — same as agents). MemGC's PRISM loop runs on the same client. | User-confirmed |
| **MemGC embedder** | BGE-M3 local (no API cost) | QUESTIONS.md Q1.8 |
| **Hosting target** | **Local first** — `make up && make dev`. Azure deploy deferred to v1. | User-confirmed Q0.5 |

---

## SVG ↔ Phase traceability

Every box in `feedme_agent_architecture_v8.svg` maps to a phase deliverable. Nothing in the SVG is dropped; nothing in the plan is outside the SVG.

| SVG element | Phase | Where in code |
|---|---|---|
| Customer touchpoints (Kiosk · Mobile · Web) | 1 | `POST /api/chat` + SSE — one responsive Web App serves all three viewports |
| Customer-facing Agent (entry point) | 1 | `src/agents/customer-facing.ts` |
| Event bus (Kafka) | 2 | `src/events/` + docker-compose Kafka |
| Kitchen Agent | 2 | `src/agents/kitchen.ts` (Kafka-triggered) |
| Inventory Agent | 2 | `src/agents/inventory.ts` (Kafka-triggered, Haiku model) |
| POS MCP | 1 | `mcp-servers/pos/` (port 4001, SQLite `data/pos.db`) |
| Kitchen Display MCP | 2 | `mcp-servers/kitchen-display/` (port 4002) |
| Payment MCP | 2 | `mcp-servers/payment/` (port 4003) |
| Supplier MCP | 2 | `mcp-servers/supplier/` (port 4004) |
| Redis (cache for MemGC.answer) | 0 ✅ infra · 3 client | `memgc:answer:{sha256}` keys, TTL 300s |
| MemGC (memory layer) | 0 ✅ stub · 3 5-endpoint impl | `memgc-service/service.py` wrapping `memgc-py` |
| Skills repository | 3 | `skills/{name}/SKILL.md` + `src/skills/loader.ts` |
| Langfuse Observability | 3 | OTel SDK → OTLP → Langfuse |
| Promptfoo Evaluation | 4 | `promptfooconfig.yaml` + `evals/golden-set/` |

---

## Repo layout

```
ai-feedme/
├── PLAN.md                       ← this file (master)
├── PHASES.md                     ← per-phase deep detail
├── SCHEMAS.md                    ← data + events + APIs
├── QUESTIONS.md                  ← open questions for review
├── REUSE_AI_AGENTS.md            ← ai-agents lift map
├── REUSE_AI_CONTACT_BUN.md       ← ai_brain lift map
├── REUSE_MEMGC.md                ← memgc integration
├── REUSE_OVERVIEW.md             ← cross-project synthesis
├── feedme_agent_architecture_v8.svg   ← target diagram
│
├── docker-compose.yml            ← ✅ Phase 0: Redis + Kafka KRaft + memgc-service
├── docker-compose.prod.yml       ← Phase 5: production variant
├── Dockerfile                    ← ✅ Bun app multi-stage
├── Makefile                      ← ✅ make up/down/dev/health/eval
├── package.json                  ← ✅ deps (kafkajs, hono, anthropic, pino, ulid, zod, …)
├── tsconfig.json + bunfig.toml   ← ✅
├── .env.example + .gitignore     ← ✅
├── promptfooconfig.yaml          ← Phase 4
│
├── src/                          ← TS supervisor + Hono server
│   ├── index.ts                  ← ✅ Phase 0: /health + /ready stub
│   ├── instrumentation.ts        ← Phase 1: OTel SDK init
│   ├── api/                      ← Phase 1: /api/chat (SSE + sync), /api/approvals (Phase 4)
│   ├── agents/                   ← agent loops
│   │   ├── agent-base.ts         ← Phase 2: shared helpers
│   │   ├── customer-facing.ts    ← Phase 1: entry
│   │   ├── kitchen.ts            ← Phase 2: Kafka-triggered
│   │   ├── inventory.ts          ← Phase 2: Kafka-triggered
│   │   ├── agent-configs.ts      ← per-agent model + maxTurns + temperature
│   │   └── locked-actions.ts     ← Phase 4: HITL gates
│   ├── brain/                    ← Phase 1: LLM router (lifted from ai_brain)
│   ├── context/                  ← Phase 1: 8-file loader + prompt-builder (lifted from ai-agents)
│   ├── events/                   ← Phase 2: Kafka producer + consumers
│   ├── memgc-client.ts           ← Phase 3: HTTP client w/ Redis cache
│   ├── skills/                   ← Phase 3: SKILL.md loader
│   ├── heartbeat/                ← Phase 3: 5-min writer
│   ├── memory-compactor/         ← Phase 3: nightly MEMORY.md compaction
│   ├── cron/                     ← Phase 3 + 5: scheduler + 5 jobs
│   ├── lib/                      ← Phase 1: logger, tracing, resilience, observability, shutdown
│   ├── middleware/               ← Phase 1: observability middleware
│   └── services/                 ← Phase 1: redis-dedup, token-recorder; Phase 4: approvals
│
├── mcp-servers/                  ← MCP HTTP JSON-RPC servers (one Bun process each)
│   ├── shared/                   ← types + format helpers (lifted from ai_brain)
│   ├── pos/                      ← Phase 1: 4 tools, schema, client
│   ├── kitchen-display/          ← Phase 2: 4 tools
│   ├── payment/                  ← Phase 2: 4 tools (refund LOCKED)
│   └── supplier/                 ← Phase 2: 5 tools
│
├── memgc-service/                ← Python FastAPI sidecar wrapping memgc-py
│   ├── service.py                ← ✅ Phase 0 stub; Phase 3 implements 5 endpoints
│   ├── pyproject.toml            ← ✅
│   ├── Dockerfile                ← ✅ dev (bind-mount memgc-py source)
│   └── Dockerfile.prod           ← Phase 5: bakes memgc-py source into image
│
├── agents/                       ← context files per agent (committed)
│   ├── customer-facing/          ← Phase 1: 10 .md files (IDENTITY, TONE, OWNER, AGENTS, TOOLS, BOOTSTRAP, MENU, OPERATIONS, HEARTBEAT, MEMORY)
│   ├── kitchen/                  ← Phase 2: + STATION_MAP, SEQUENCING
│   └── inventory/                ← Phase 2: + INVENTORY
│
├── skills/                       ← Phase 3: procedural .md playbooks
│   ├── upsell/SKILL.md
│   ├── vip_protocol/SKILL.md
│   ├── handle_complaint/SKILL.md
│   ├── allergen_check/SKILL.md
│   ├── 86_item_protocol/SKILL.md
│   ├── escalate_human/SKILL.md   ← lifted from ai_brain
│   └── search_knowledge/SKILL.md ← lifted from ai_brain
│
├── evals/                        ← Phase 4: Promptfoo test suites
│   └── golden-set/
│       ├── happy-path.yaml       (10 tests)
│       ├── edge-cases.yaml       (10 tests)
│       ├── red-team.yaml         (5 tests)
│       └── multi-turn.yaml       (5 tests)
│
├── grafana/  prometheus/  tempo/ ← Phase 3: observability stack (lifted from ai_brain)
├── caddy/                        ← Phase 5: reverse proxy + auto-TLS
├── scripts/                      ← seed-pos, seed-supplier, seed-memgc-sarah, deploy.sh, seed-demo.sh
│
└── data/                         ← runtime data (gitignored, single tenant)
    ├── memgc.db
    ├── pos.db
    ├── kitchen-display.db
    ├── payment.db
    ├── supplier.db
    └── agents/                   (runtime overrides for HEARTBEAT.md, MEMORY.md)
        ├── customer-facing/
        ├── kitchen/
        └── inventory/
```

---

## Phase status overview

| Phase | Status | Goal | Effort | Detail |
|---|---|---|---|---|
| **0** Scaffolding | ✅ **DONE** | Project boots, infra defined, /health works | — | `PHASES.md §0` |
| **1** Customer-facing Agent + POS MCP | ⏳ Next | `/api/chat` → search menu → create order → SSE reply | ~8 days | `PHASES.md §1` |
| **2** Three agents + Kafka | 📋 Planned | Customer-facing publishes → Kitchen + Inventory react via Kafka | ~10 days | `PHASES.md §2` |
| **3** MemGC + Skills + Observability | 📋 Planned | Sarah remembered Day 1 → Day 2; skills load; Langfuse traces visible | ~10 days | `PHASES.md §3` |
| **4** HITL + 30 Evals | 📋 Planned | Manager approval flow; Promptfoo ≥27/30 passing | ~5 days | `PHASES.md §4` |
| **5** Single-tenant deploy | 📋 Planned | Prototype on hosted VM, public URL, restart-safe, daily 9 AM summary | ~5 days | `PHASES.md §5` |

**Total**: ~38 working days = **~7-8 calendar weeks** (1 senior eng).

Aggressive parallelization (split MCP servers across days) could compress to **5-6 weeks**.

---

## Glossary

| Term | Meaning |
|---|---|
| **Agent** | An LLM (Claude/Azure) with a specific system prompt + tool set. Three of them in FeedMe: Customer-facing, Kitchen, Inventory. |
| **MCP server** | Model Context Protocol server. A long-running Bun process exposing tools via HTTP JSON-RPC. FeedMe has 4: POS, Kitchen Display, Payment, Supplier. |
| **Brain** | Internal name for our LLM router module. Multi-provider, streaming, MCP-aware. Lifted from `ai_brain/src/brain/`. |
| **Skill** | A procedural `.md` playbook. NOT a tool — it's instructions the LLM reads on demand via `load_skill`. |
| **PRISM loop** | MemGC's 10-13-LLM-call agentic retrieval pipeline (Analyzer → Selector ⇔ Adder → Generator x N → Verifier). Slow (~8s) but high-quality memory recall. |
| **HITL** | Human-In-The-Loop. The manager-approval flow for sensitive actions (comps, refunds, voids). |
| **REMY** | FeedMe's existing AI assistant for business intelligence ("Ask your POS anything"). Lives outside this prototype; mentioned in the SVG as a future memory consumer. |
| **86** | Restaurant slang for "we're out of that item". Used as a verb (`86 the mushroom swiss`) and adjective (`mushroom swiss is 86'd`). |
| **`fire_at`** | Kitchen scheduling — when to start cooking a ticket so multi-station items plate together. |
| **par level** | Inventory threshold — when stock drops below par, reorder is triggered. |
| **WAL** | SQLite's Write-Ahead Log journal mode — better concurrent perf than default. |
| **KRaft** | Kafka's mode without Zookeeper (Kafka Raft). Simpler ops. |
| **ULID** | Time-sortable unique ID (`01H...`). Used for `order_id`, `ticket_id`, etc. |

---

## Performance targets

| Path | p50 | p99 | Why |
|---|---|---|---|
| `/api/chat/sync` first message (cold MemGC) | <12s | <25s | Sonnet turn + PRISM `answer()` for profile |
| `/api/chat/sync` follow-up (warm cache) | <3s | <8s | Redis hit on profile + cached agent context |
| `/api/chat` SSE first byte | <1s | <2s | Streaming starts before tool calls complete |
| MCP tool call | <100ms | <500ms | Bun + SQLite + zero network hops |
| Kafka publish | <50ms | <200ms | Single-broker local KRaft |
| memgc-service `/answer` cold | <15s | <80s | 10-13 LLM calls; aggressive Redis cache |
| memgc-service `/extract` | <3s | <8s | Single LLM call |

Full discussion: `PHASES.md §Cross-cutting/Performance targets`.

---

## Cost targets

| Path | Tokens | Cost | Volume |
|---|---|---|---|
| Single order (simple) | 1500 in + 100 out | $0.005-0.01 | Dominant path |
| Order with VIP context | 3000 in + 150 out | $0.015 | ~10% of orders |
| MemGC PRISM `answer()` | 5000 in + 200 out | $0.02 | Amortized to ~$0.004 via 5min Redis cache |
| MemGC `extract()` | 800 in + 100 out | $0.003 | Per order |
| Daily summary cron | 500 in + 200 out | $0.003 | 1/day |

**Projection**: 100 orders/day → **~$1.50–$3.50/day in LLM**. Acceptable.

---

## Risk register

| Risk | Severity | Mitigation |
|---|---|---|
| **PRISM latency** (10-13 LLM calls, up to 80s) | High | Redis cache 5-min TTL; prefetch on customer arrival; option to route Analyzer + Verifier to Haiku |
| **Kafka single-node KRaft fails** | Medium | Document `docker compose restart kafka` recovery; consumers auto-reconnect; acceptable for prototype |
| **SQLite WAL corruption on hard kill** | Low | WAL mode + `synchronous=NORMAL`; nightly `PRAGMA wal_checkpoint(TRUNCATE)` |
| **MCP server crashes mid-order** | Medium | Circuit breaker from `ai_brain/src/lib/resilience/` auto-excludes failed MCP; agent gets tool error, recovers |
| **memgc-py source bind-mount drifts** | Low | Phase 5 bakes source into prod image; document dev workflow |
| **LLM API rate limits / outage** | High | Brain module provider fallback (Anthropic → Azure); retry logic; the second-best provider is always cooked into the chain |
| **Inflated token usage from runaway agent loop** | Medium | `maxTurns` per-agent (8 / 6 / 4); JIT compaction at 80k tokens; per-day cost alert |
| **Customer prompt injection** | Medium | Promptfoo red-team suite in Phase 4; system prompt instructs refusal; never reveal system prompt verbatim |
| **Concurrent SQLite writes from multiple MCPs** | Low | Each MCP owns its own DB file; no cross-MCP writes |
| **WAL file growth unbounded** | Low | Nightly checkpoint cron (Phase 5) |

Full discussion: `QUESTIONS.md §6` (policy decisions).

---

## Security model (single-tenant prototype)

- **No user accounts** — anonymous orders work; identified orders use `customer_id` provided by client
- **Manager auth** — `/api/approvals/*` routes guard via shared bearer token in `.env` (`MANAGER_API_KEY`)
- **Internal service auth** — `X-Internal-Secret` header on memgc-service and MCP servers
- **Prompt-injection defense** — Promptfoo red-team suite (Phase 4); system prompt instructs strict refusal
- **Secrets management** — `.env` never checked in; `.env.example` is the template
- **Data at rest** — SQLite files on VM filesystem; no encryption in prototype

**Multi-tenant security** (tenant isolation via X-Account-Id headers, per-tenant DB segregation) — deferred to v1.

---

## Testing strategy

| Layer | Tool | Coverage | Phase |
|---|---|---|---|
| Unit | `bun test` | Pure functions (schema validators, parsers, formatters) | Phase 1+ |
| Integration (per-MCP) | `bun test` | Each MCP server with real SQLite + Kafka stub | Phase 1+ |
| Agent quality | Promptfoo `golden-set/` (30 tests) | End-to-end conversation correctness + cost | Phase 4 |
| Smoke | `make health` | All sidecars reachable | Phase 0+ (already) |
| Restart safety | `docker compose restart` mid-conversation | State on disk; session resumable | Phase 5 |
| Red team | Promptfoo `red-team.yaml` | Prompt injection, PII extraction | Phase 4 |
| Performance | manual + Langfuse | p50/p99 within targets | Phase 5 |

---

## Where we are right now

### ✅ Done

**Phase 0 — Scaffolding** (shipped):

- `docker-compose.yml` (Redis + Kafka KRaft + memgc-service) — valid syntax
- `Dockerfile`, `Makefile`, `package.json`, `tsconfig.json`, `bunfig.toml` — typecheck clean
- `src/index.ts` Hono /health + /ready — boots in 2ms
- `memgc-service/{service.py,pyproject.toml,Dockerfile}` — /health returns ok
- `.env.example`, `.gitignore`
- 116 deps installed via `bun install` (5.67s)

### ⏳ Next (one-time setup)

You run:

```bash
cd /Users/carrickcheah/Project/root_ai/ai-feedme
cp .env.example .env
# edit .env — add ANTHROPIC_API_KEY + AZURE_OPENAI_API_KEY
make up        # pulls Redis ~50MB, Kafka ~600MB, builds memgc-service ~150MB
make health    # verify all four services green
```

### 🚦 After review of this plan + setup green

→ **Phase 1 begins**. Fork supervisor → `customer-facing.ts`, lift Brain + context, build POS MCP. ~8 working days.

---

## Review checklist

Before greenlighting Phase 1, please:

1. **Skim `PLAN.md`** (this file) — confirm decisions in §Locked Decisions
2. **Skim `PHASES.md §1`** — confirm Phase 1 scope is right
3. **Walk `QUESTIONS.md`** — answer the §0 strategic questions (~10 min) and any §5 you have answers for now
4. **Run `make up && make health`** — verify infra
5. **Reply with**: "go" or "wait, here are changes"

If you want to walk through any section of `PHASES.md` / `SCHEMAS.md` / `QUESTIONS.md` in conversation, just say which section.

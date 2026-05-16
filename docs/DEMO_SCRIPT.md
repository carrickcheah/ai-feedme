# DEMO_SCRIPT.md — FeedMe Interview Walkthrough

**Audience:** Lead Agentic AI Engineer interview panel
**Time budget:** ~12 min demo + Q&A
**Prototype scope:** single-tenant, SQLite, web kiosk only. No WhatsApp. No real payments.

---

## Before you start — boot checklist (~2 min)

Run these in 4 separate terminal tabs (top to bottom; each waits on the previous):

```bash
# Tab 1 — infra
docker compose up -d redis memgc-service     # Redis + Python MemGC sidecar

# Tab 2 — MCP servers (4 of them, in one process)
bun run mcp:all                              # pos:4001, kitchen-display:4002, payment:4013, supplier:4014

# Tab 3 — main agent server
bun src/index.ts                             # :8002 — look for [OTEL] OpenTelemetry initialized → …

# Tab 4 — frontend
cd snow-dessert && bun run dev               # opens browser; click "AI Assistant" bubble
```

Browser tabs to keep open:
1. **snow-dessert UI** — `http://localhost:5173` (the kiosk)
2. **Langfuse Cloud** — [cloud.langfuse.com → project → Traces](https://cloud.langfuse.com)
3. **Architecture SVG** — `feedme_agent_architecture_v8.svg`
4. **Terminal** — ready to run `bun run eval`

---

## The Pitch (60s)

> FeedMe is a SaaS POS + kiosk for ~10K F&B merchants in MY/SG. I built a 3-agent AI system: **Customer-facing** handles the chat, **Kitchen** generates tickets + tracks ingredient burn, **Inventory** auto-86s the menu when stock drops below par. Three agents, four MCP servers, Kafka events, MemGC agentic memory — fully instrumented in Langfuse.

[**Point at v8 SVG.**]
> No central orchestrator. Each agent owns its lane and the Kafka event bus is the nervous system. That's how you scale to 10K merchants without an orchestrator becoming the bottleneck.

---

## Wow #1 — VIP Recognition (2 min)

1. In snow-dessert UI, toggle **★ Demo: Sarah** ON.
2. Type: `Hi`
3. **Expect:** "Welcome back, Sarah! Want your usual Mango Iceyoo?"
4. Switch to Langfuse tab → refresh → click the new trace.

> See `feedme.memgc.answer` as a child span — that's the PRISM agentic retrieval loop (Analyzer → Selector ↔ Adder → Generator → Verifier). Cost on the parent span. Tools called: `pos__search_menu`. Latency end-to-end on the root span.

**Tell them:** *MemGC isn't a vector DB. It's a 4-agent retrieval loop that builds an answer iteratively — closer to how a human recalls a regular customer than to RAG.*

---

## Wow #2 — Event-Driven Auto-86 (3 min)

1. Place **3 Mango Iceyoo orders** back-to-back (still as Sarah).
2. Watch **Tab 3 (server log)** scroll:
   - `[AGENT customer-facing] complete` (3 ×)
   - `[KAFKA] order.created → in-process fallback → kitchen agent`
   - `[AGENT kitchen] ticket created`
   - `[KAFKA] ingredient.consumed × N` (each ingredient in the recipe)
   - `[AGENT inventory] stock check`
   - `[EVENT] stock.low` once mango syrup dips
   - `[86] menu_item.is_available = 0 for SKU mango_iceyoo`
3. Try ordering a **4th** Mango Iceyoo.
4. **Expect:** "Sorry, Mango Iceyoo just sold out. Want to try Tutti Frutti Ice Blended (same price RM12.90)?"

[**Switch to Langfuse.**] Show the trace tree for the 4th order — `feedme.agent.run` → `feedme.tool.call (pos__search_menu)` → the search returns the item with `is_available=0`, agent reasons + redirects.

**Tell them:** *Kafka unreachable? The publisher falls back to in-process function calls. Same end state, demo works without a broker.*

---

## Wow #3 — Engineering Rigor (3 min)

[**Tab 4 — terminal**]

```bash
bun run eval                                 # ~60s, ~$0.30
```

While it runs, narrate:
- **30 tests** across 4 suites — happy path, edge cases, red team, multi-turn
- **Azure GPT-5.5 grades itself** via `llm-rubric` — one external dependency
- **Red team includes prompt injection, PII extraction, jailbreak, SQL injection** — Azure Content Safety blocking counts as PASS (defense-in-depth)

Expect output:
```
✓ 24 passed (80.00%)
✗ 6 failed (20.00%)
0 errors
Duration: 57s
```

**Tell them:** *80% baseline. The 6 failures are mostly rubric strictness or Content Safety filter timing on red-team cases — honest numbers, not a tuned-to-100 lie. The framework runs in CI; this is what nightly regression looks like.*

```bash
bun run eval:view                            # opens HTML dashboard
```

---

## Closing (90s)

> Everything you saw is in one Langfuse view. Click a trace → see the agent role, tools called, MemGC retrievals, token counts, cost, and any error.

[**Show one rich trace.**]

**Roadmap to production-ready for 10K merchants:**
| Now (prototype) | Production |
|---|---|
| SQLite single tenant | Postgres + per-tenant schemas |
| In-process Kafka fallback | Real Kafka cluster, consumer groups |
| Single MemGC SQLite | Per-merchant memgc dbs + Dreaming worker |
| Manual evals | Promptfoo in CI, gated on PR merge |
| No payments | Stripe + GrabPay + DuitNow integrations |
| Web kiosk only | WhatsApp + voice via Vapi/Retell |

---

## If Something Breaks

| Symptom | What to say + do |
|---|---|
| MemGC takes 30s on cold start | "First call is cold — PRISM does 4 LLM rounds. Redis 5-min cache makes warm calls instant." Switch to a cached query or skip Wow #1. |
| Stock chain doesn't fire | "Kafka isn't local — in-process fallback should pick this up. Let me check the publisher log." If still broken: skip auto-86, go straight to evals. |
| Eval suite times out | Show pre-recorded `eval:view` HTML from `evals/last-run/`. |
| Trace not in Langfuse | "Batch exporter has 5–10s delay. Refresh once." If still missing: show `[OTEL] OpenTelemetry initialized` line in tab 3 — the wire is real. |
| UI bubble doesn't open | Skip the kiosk, demo via `curl POST /api/chat/sync` directly. Show JSON. |
| Azure rate-limited | Show the 80% eval result from `evals/last-run/report.html` instead of re-running. |

**Golden rule:** if anything looks slow or broken, **say so out loud** ("This is the cold-start path; warm calls hit Redis cache and finish in 200ms"). Honest commentary > silent stalling.

---

## Stack Recap (for the Q&A inevitably-asked)

```
Frontend:  React + Yoga (snow-dessert kiosk)
Server:    Bun + Hono + TypeScript
LLM:       Azure OpenAI GPT-5.5 (reasoning_effort = none|low|medium|high per agent)
Memory:    Python FastAPI sidecar wrapping memgc-py + BAAI/bge-m3 embedder
Tools:     4 MCP servers (HTTP JSON-RPC) — POS, Kitchen Display, Payment, Supplier
Storage:   SQLite (WAL + FTS5) — single-tenant prototype scope
Events:    Kafka KRaft (with in-process function fallback when broker unreachable)
Cache:     Redis (MemGC answers, TTL 300s)
Tracing:   OpenTelemetry → Langfuse Cloud (OTLP HTTP)
Eval:      Promptfoo (Azure GPT-5.5 as rubric grader)
```

---

## Honest Caveats — own them upfront

- **Single tenant.** Real FeedMe is multi-tenant with row-level isolation. I chose single-tenant SQLite to ship the agentic substrate in days, not weeks.
- **No real payments.** Payment MCP returns stubs. Production needs Stripe + GrabPay + DuitNow + receipt tax compliance.
- **No WhatsApp.** Web kiosk only. WhatsApp is a Baileys/Cloud-API channel adapter — same agent core, different input adapter.
- **80% eval pass rate, not 100%.** 6 failing tests are mostly rubric strictness on borderline cases. I documented why each failed instead of tuning the test until it passed — that's the more honest signal.
- **Built solo, ~3 days.** The plan, the code, the evals, the demo. A team would have higher polish and breadth; one person has tighter architectural coherence. Trade-off.

---

## One-line elevator if you forget everything else

> "Three agents, four MCP servers, MemGC for memory, Kafka for coordination, Langfuse for traces, Promptfoo for evals — and it actually runs."

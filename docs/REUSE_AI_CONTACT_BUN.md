# Reusing `ai-contact-bun` (specifically `ai_brain/`) for FeedMe

> **Source**: `/Users/carrickcheah/Project/root_ai/ai-contact-bun/ai_brain`
> **Status**: Production AI Contact Centre. Supervisor agent + MCP + Promptfoo evals all shipped.
> **Verdict**: **The closest match to FeedMe by use case.** E-commerce ordering, WhatsApp flow, payment intents — all the operational patterns FeedMe needs are already here. **Lift the most.**

---

## Project Purpose

AI-powered customer service platform for e-commerce. A single **Supervisor Agent** running on Claude (later switched to Brain module) handles inbound messages from WhatsApp, web widget, Telegram, LINE, TikTok, WeChat, Messenger, Instagram — and uses MCP servers as tools to search products, manage carts, generate checkout URLs, process returns, look up orders. Ships HITL (human-in-the-loop) approval flow for sensitive actions like refunds. Per-tenant skills loaded from `.claude/skills/`. ~155 Promptfoo eval tests covering prompt quality, red-team, skill routing, and multi-language.

For FeedMe, this is the closest analog: **e-commerce + chat + cart + checkout** is structurally identical to **restaurant + order + payment**. The Supervisor pattern + MCP servers + Skills + Promptfoo eval suite is essentially the FeedMe blueprint with food swapped for retail.

---

## Tech Stack

| Layer | Choice |
|---|---|
| Runtime | **Bun** |
| Language | TypeScript |
| HTTP | **Hono** |
| LLM | Brain module (Anthropic Bedrock, Azure OpenAI, OpenAI, Gemini, DeepSeek) |
| MCP transport | HTTP JSON-RPC (custom) + SSE (legacy) |
| DB | **PostgreSQL** (`pg` direct queries) + **Drizzle ORM** in chat_now |
| Graph DB | **FalkorDB** (knowledge graph over contacts) |
| Vector DB | **Cloudflare Vectorize** (Workers managed) |
| Cache | **ioredis** (dedup, circuit breakers) |
| Queue/Scheduler | `croner` |
| Observability | **OpenTelemetry** (OTLP → Grafana) + **Langfuse** (legacy, removed) |
| Eval | **Promptfoo** with Bedrock Sonnet 4.5 as judge |
| Resilience | Custom circuit breaker per MCP server |
| Auth | X-Account-Id header (tenant isolation) + X-Internal-Service+Secret (service-to-service) |
| Channels | WhatsApp Cloud API, WhatsApp Web (Baileys 6.7), Telegram, chat_now, Meta (Messenger/Instagram), LINE, TikTok, WeChat, EasyStore, Shopify |
| Logs | `pino` |

Notable: no `@anthropic-ai/sdk` direct in `ai_brain` — they call Claude via Brain's MCP HTTP layer. `@anthropic-ai/bedrock-sdk` for AWS Bedrock. Uses **Google GenAI** (`@google/genai`), `yahoo-finance2`, `technicalindicators` — those last two are remnants of a financial side-feature, not relevant to FeedMe.

---

## Directory Structure (`ai_brain/`)

```
ai_brain/
├── src/
│   ├── index.ts                  # ⭐ Hono server entry (port 8002)
│   ├── instrumentation.ts        # OpenTelemetry init (must import first)
│   ├── agents/
│   │   ├── supervisor.ts         # ⭐⭐ The Supervisor Agent — main loop
│   │   ├── assistant-agent.ts    # Admin/tenant-facing agent
│   │   ├── agent-configs.ts      # Per-agent model/maxTurns/temp
│   │   └── index.ts
│   ├── api/                      # Hono routes
│   │   ├── webhooks/             # WA / Telegram / chat-now / Meta / LINE / TikTok / WeChat / EasyStore
│   │   ├── copilot.ts            # Staff copilot streaming
│   │   ├── assist.ts             # Tenant agent streaming
│   │   ├── ai-tools.ts           # AI personality field generation
│   │   ├── easystore-oauth.ts
│   │   ├── shopify-oauth.ts
│   │   ├── internal-skills.ts    # Service-to-service cache bust
│   │   └── observability.ts      # Live dashboard endpoints
│   ├── brain/                    # 🔥 LLM router (same pattern as ai-agents)
│   │   ├── runner.ts             # run() / runSync() streaming + sync
│   │   ├── mcp-client.ts         # HTTP JSON-RPC MCP client
│   │   ├── sanitize.ts           # Prompt sanitizer
│   │   ├── session.ts
│   │   ├── tool-adapter.ts
│   │   ├── fallback.ts           # Provider fallback chain
│   │   ├── cost.ts
│   │   └── providers/
│   ├── config/                   # env + constants + MCP_SERVERS map
│   ├── cron/scheduler.ts         # Per-tenant scheduled tasks
│   ├── lib/
│   │   ├── observability/        # ⭐ metrics-collector + alert-evaluator
│   │   ├── resilience/           # ⭐ Circuit breaker per MCP server
│   │   ├── platform-cache.ts     # Per-tenant connected-platforms cache
│   │   ├── personality-client.ts # Fetches tenant personality from chat_now
│   │   ├── personality-prompt.ts # Composes personality into system prompt
│   │   ├── tracing.ts            # observe() wrapper
│   │   ├── tracer.ts             # In-process execution tracer
│   │   ├── reconciliation.ts     # Daily product sync 3am
│   │   ├── falkordb.ts           # Graph client
│   │   ├── shutdown.ts           # Graceful shutdown
│   │   └── logger.ts             # pino
│   ├── loaders/                  # Tenant-file loaders
│   ├── middleware/observability.ts
│   ├── services/
│   │   ├── credit-gate.ts        # Billing — deduct credits per call
│   │   ├── redis-dedup.ts        # Dedup duplicate webhook deliveries
│   │   └── token-recorder.ts     # Records token usage to DB
│   ├── tools/                    # Internal tool definitions
│   ├── tunder/                   # CLI/admin tools
│   ├── types/                    # TS definitions
│   └── whatsapp-web/             # ⭐ Baileys multi-tenant manager
│       ├── session-manager.ts    # reconnectAll() on boot
│       └── message-handler.ts
│
├── mcp-servers/                  # ⭐⭐ Five MCP servers
│   ├── shared/                   # Common types + embeddings helper
│   ├── chat-now/                 # 24 tools — conversations, contacts, memory, graph
│   ├── easystore/                # E-commerce — search, cart, checkout, orders
│   ├── admin-crud/               # Tenant CRUD ops
│   ├── admin-reports/            # Reporting (REMY-style!)
│   └── admin-research/           # Research (web search via Tavily)
│
├── .claude/skills/               # ⭐ Skills directory (auto-discovered)
│   ├── search_products/          # ← restaurant analog: search_menu
│   ├── order_lookup/             # ← restaurant analog: order_status
│   ├── return_request/           # ← restaurant analog: complaint_handle
│   ├── promotions/               # ← restaurant analog: upsell + loyalty
│   ├── shopping/                 # ← restaurant analog: cart + checkout
│   ├── escalate_human/           # ← lift directly
│   ├── search_knowledge/         # ← lift directly (FAQ search)
│   ├── graph_context/            # ← lift directly (multi-hop context)
│   ├── admin/                    # Admin-side ops
│   └── skill-creator_prod/       # Meta-skill that creates skills
│
├── evals/                        # ⭐⭐ Promptfoo test suites
│   ├── e2e/
│   ├── green-methods/            # Customer's branded tests
│   ├── wohoo-pet-treats/         # Demo tenant's test data
│   └── MANUAL.md
│
├── prompts/                      # System prompts (curated)
│   ├── faq-copilot.md
│   └── stuff_support.md
│
├── promptfooconfig.yaml          # Eval entry point — 155 tests across 4 suites
├── docker-compose.yml            # Local dev
├── docker-compose.local.yml
├── claude_exam.pdf               # 🟡 (internal — eval prompts)
├── grafana/, prometheus/, tempo/ # 🟢 Observability stack
└── package.json
```

The cleanest part is the **separation of concerns**: agent (supervisor.ts), tools (mcp-servers/), procedural memory (.claude/skills/), evals (evals/), config (config/), observability (lib/observability/). Each is independently liftable.

---

## Key Components

- **`src/index.ts`** — Hono server, port 8002. Wires every route. Look at lines 33-77 for the import pattern.
- **`src/agents/supervisor.ts`** — **757 lines.** The Supervisor pattern. Pre-flight MCP health check, per-tenant system-prompt build (personality + FAQ + skill index), Brain run with tool gate for locked actions, message-loop state machine, token + credit accounting, tracing, streaming variant via `processWithStreaming` generator.
- **`src/agents/agent-configs.ts`** — model, maxTurns, temperature per agent.
- **`src/brain/runner.ts`** — same Brain pattern as ai-agents (run + runSync).
- **`src/lib/personality-prompt.ts`** — composes tenant personality config + FAQ + skill index into system prompt. **This pattern transfers to FeedMe's per-restaurant personality.**
- **`src/lib/platform-cache.ts`** — caches "which platforms has tenant X connected?" — drives conditional MCP server registration.
- **`src/lib/resilience/`** — circuit breaker pattern. Tracks MCP server health, excludes unhealthy ones from next request.
- **`mcp-servers/chat-now/index.ts`** — **canonical MCP server template.** Hono + JSON-RPC + SSE. X-Account-Id tenant isolation. `/health`, `/mcp` (POST JSON-RPC), `/sse` (streaming), `/messages` (legacy), `/tools/:name` (direct). 328 lines.
- **`mcp-servers/easystore/`** — e-commerce specifics. **This is the FeedMe POS MCP starter** — same shape (search_products → search_menu, get_cart → get_order, generate_checkout_url → process_payment).
- **`mcp-servers/admin-reports/`** — analytics/reporting MCP. The REMY analog for FeedMe — adapt for "sales today", "top items", "wait time histogram".
- **`mcp-servers/shared/`** — common types (`ToolDefinition`, `MCPToolResult`), shared `formatJsonResult/formatErrorResult/formatListResult`, embeddings helper.
- **`.claude/skills/`** — **filesystem skills with `SKILL.md` per directory.** Auto-discovered.
- **`promptfooconfig.yaml`** — 155-test eval suite.

---

## 🟢 Directly Reusable

### 1. The Supervisor pattern — `src/agents/supervisor.ts`

**Why for FeedMe**: The Customer-facing Agent IS the Supervisor with a different domain. Copy this file as `customer-facing-agent.ts`, swap MCP server URLs, replace `LOCKED_REVIEW_ACTIONS` for refunds with restaurant-specific lockdowns (e.g. `mcp__pos__void_completed_order`).

Key patterns to keep:
- `_setupInfra()` cache (lines 81-93)
- `_buildSystemPrompt(accountId)` (lines 98-153) — fetches personality + FAQ + skills, composes prompt
- `_buildTenantMcpServers(baseMcpServers, platforms)` — conditional MCP registration based on what tenant has enabled
- `_checkMcpHealth()` (lines 472-490) — pre-flight health check; fail-fast if MCP server unreachable
- `LOCKED_REVIEW_ACTIONS` set (lines 66-73) — HITL gates that **always require human approval**
- `_extractTokenUsage` + `recordTokenUsage` + `deductCreditsViaApi` (lines 386-655) — full billing path
- `processWithStreaming` async generator (lines 686-745) — SSE streaming variant

### 2. MCP server template — `mcp-servers/chat-now/index.ts`

**Why for FeedMe**: This is the template for **POS MCP, Kitchen Display MCP, Payment MCP, Supplier MCP** — every single FeedMe MCP server. 328 lines, Hono + JSON-RPC + SSE + tenant isolation via X-Account-Id.

Specific patterns to lift verbatim:
- `readTenantId(headerValue)` (lines 45-52) — **mandatory tenant validation pattern**
- `/health` endpoint shape
- `/mcp` POST handler with method dispatch (`initialize`, `tools/list`, `tools/call`)
- `setupShutdown()` graceful shutdown (lines 299-310)
- The tenant-id-from-header-not-LLM-args invariant — **this is a security pattern. Copy verbatim.**

### 3. Tool definitions pattern — `mcp-servers/chat-now/tools.ts`

```typescript
export const toolDefinitions: ToolDefinition[] = [
  {
    name: "get_conversation",
    description: "...",
    inputSchema: { type: "object", properties: {...}, required: [...] }
  }, ...
];
export async function executeTool(toolName: string, args: Record<string, unknown>, accountId: number): Promise<MCPToolResult>
```

That's the contract. **Use it for every FeedMe MCP server.**

### 4. The Skills directory pattern — `.claude/skills/<name>/SKILL.md`

**Why for FeedMe**: Restaurant agents need procedural memory. Lift the structure.

Each skill folder has:
- `SKILL.md` — markdown procedural memory (the "how to do X" playbook)
- Optional `*.ts` helpers if the skill needs code

Skills as-is (lift names AND content as starting points):
- **`escalate_human`** → identical for FeedMe (transfer to staff)
- **`search_knowledge`** → identical (FAQ search)
- **`graph_context`** → restaurant analog: multi-hop context lookup

Skills to **rename + adapt**:
| ai_brain skill | FeedMe skill | What changes |
|---|---|---|
| search_products | search_menu | Domain |
| order_lookup | order_status | Same shape |
| return_request | complaint_handle | Same shape (refund→remake) |
| promotions | upsell + loyalty | Combine and adapt |
| shopping | cart_checkout | Same shape |

### 5. Promptfoo eval suite — `promptfooconfig.yaml` + `evals/`

**Why for FeedMe**: Pre-deploy quality gate. FeedMe will have golden-set scenarios ("VIP orders during rush", "out-of-stock mid-order"). The structure is already there:
- 4 suites: prompt-quality, red-team, skill-routing, multi-language
- Bedrock Sonnet 4.5 as judge model
- Per-tenant test files (`green-methods/`, `wohoo-pet-treats/` shows the multi-tenant test layout)
- Hierarchical includes via `file://evals/...`

```yaml
# Copy and adapt for FeedMe
defaultTest:
  options:
    provider:
      id: bedrock:global.anthropic.claude-sonnet-4-5-20250929-v1:0
      config: { region: ap-southeast-2, temperature: 0 }
prompts: [{ id: customer-facing-agent, raw: "..." }]
tests:
  - file://evals/prompt-quality.yaml
  - file://evals/red-team.yaml
  - file://evals/skill-routing.yaml
  - file://evals/multi-language.yaml
```

### 6. The Resilience / Circuit Breaker — `src/lib/resilience/`

**Why for FeedMe**: When the POS API is down, the agent shouldn't bombard it. Circuit breaker auto-excludes failing MCP servers from the next request set. Pattern visible in `supervisor.ts:13` TODO and `src/lib/resilience/`.

### 7. Observability stack — `lib/observability/` + `grafana/` + `prometheus/` + `tempo/`

**Why for FeedMe**: OpenTelemetry → Grafana / Prometheus / Tempo is a ready-to-use observability stack. `grafana/`, `prometheus/`, `tempo/` directories at project root contain pre-built dashboards and configs. Slot into FeedMe's `docker-compose.yml` and you have production observability day one.

`src/lib/observability/metrics-collector.ts` + `alert-evaluator.ts` give you the in-process metrics + alert layer (visible at lines 75-77 of `index.ts`).

### 8. WhatsApp Web multi-tenant — `src/whatsapp-web/`

**Why for FeedMe**: Restaurants want WhatsApp ordering. `session-manager.ts` handles per-tenant Baileys sessions with `reconnectAll()` on startup. `message-handler.ts` routes inbound to the agent. **Drop-in copy** with tenant ID becoming restaurant ID.

### 9. Brain module — `src/brain/`

Same as ai-agents but ai_brain's version is slightly leaner. Pick whichever has the providers FeedMe needs. The `mcp-client.ts` HTTP JSON-RPC client is the cleaner one here.

### 10. The credit/billing path — `src/services/credit-gate.ts` + `token-recorder.ts`

**Why for FeedMe**: Multi-tenant SaaS has to bill per token. The pattern in supervisor.ts:619-653 — `deductCreditsViaApi(...)` + `recordTokenUsage(...)` — is shipped, awaited (billing must not be lost), with fail-safe warnings.

### 11. The `_buildSystemPrompt()` pattern (lines 98-153)

Pulls personality + FAQ + skill index from the chat_now service via HTTP, composes the prompt. The skill **index** (names + descriptions) goes in prompt, full skill body is loaded on demand by the LLM. Token-efficient.

```typescript
prompt += `\n\n<available_skills>\n${skillIndex}\n</available_skills>\n\nBefore replying: scan <available_skills>. If one applies, use the relevant MCP tools to fulfill the workflow. If none apply, answer directly.`;
```

Copy this snippet verbatim into FeedMe.

### 12. Tenant isolation via X-Account-Id (security pattern)

Three places to copy:
- Webhook handler resolves account_id from channel identity (NOT from message body)
- Brain MCP client sets `X-Account-Id` header on every MCP HTTP call
- Every MCP server validates `X-Account-Id` header — **never trusts LLM-supplied account_id in tool args**

See `chat-now/index.ts:42-52` and the comment in `tools.ts:18-19` — this is the documented invariant.

---

## 🟡 Needs Adaptation

### Single Supervisor → 3 Agents

`supervisor.ts` is one agent (the customer-facing one, by virtue of how it's used). FeedMe needs three. Fork the file into `customer-facing-agent.ts`, `kitchen-agent.ts`, `inventory-agent.ts`. Each gets its own subset of MCP servers via `_buildTenantMcpServers()`:
- Customer-facing: POS, payment, chat_now
- Kitchen: KDS, POS (read-only)
- Inventory: POS (read-only), supplier, KDS (write)

### MCP server list

Keep the **template** (chat-now/index.ts) and **shared/** types. Replace the specific MCP server contents:

| Drop | Add |
|---|---|
| `mcp-servers/easystore/` (e-commerce) | `mcp-servers/pos/` (Toast/Square/in-house POS) |
| `mcp-servers/admin-research/` (web search) | `mcp-servers/kitchen-display/` (KDS) |
| `mcp-servers/admin-crud/` (tenant admin) | `mcp-servers/payment/` (Stripe/local payment) |
| - | `mcp-servers/supplier/` (Sysco/local supplier) |

Keep `mcp-servers/chat-now/` (channel-side) and `mcp-servers/admin-reports/` (REMY-style reporting).

### `chat_now` PostgreSQL schema

ai_brain talks to chat_now's Postgres directly for conversation/contact/message data. FeedMe might want to keep this for the conversation channel-side, but the **restaurant operational data** (orders, menu, stock) lives in a different schema. Don't conflate.

### `.claude/skills/` location

`.claude/skills/` is auto-discovered. For FeedMe, decide between:
- Same path (`.claude/skills/`) — works if FeedMe uses the same Claude Code skill discovery
- Custom path (`restaurant_skills/`) — cleaner namespacing

The loader is in `loaders/` directory — easy to redirect.

### Replace `personality-client` (HTTP fetch from chat_now)

`supervisor.ts:15` imports `fetchPersonality` + `fetchTenantConfig` from a remote service. FeedMe should either:
- Keep the same shape if FeedMe has a similar service registry
- Replace with local DB queries to the restaurant's config table

### MEMORY ↔ MemGC

ai_brain doesn't use MemGC. It has its own memory (conversation_search, save_conversation_summary in chat-now MCP). FeedMe should **replace those memory tools with MemGC calls** — see REUSE_MEMGC.md.

---

## 🔴 Not Relevant

- `mcp-servers/admin-research/` — Tavily web search; FeedMe doesn't need general web search
- `claude_exam.pdf` — internal eval reference, ignore
- `src/whatsapp-web/` is also in ai-agents — pick the more mature one (ai-agents has 7.0-rc9)
- `src/tunder/` — internal CLI admin tooling
- `yahoo-finance2`, `technicalindicators` deps — financial side-project remnants
- `mcp-servers/easystore/lib/` Shopify-specifics — only useful for FeedMe if you ever integrate Shopify
- `tempo/` — distributed tracing; nice-to-have, can defer to Phase 2
- `falkordb` knowledge graph — ai_brain uses it for contact relationships; FeedMe may or may not need graphs for VIP networks

---

## Integration Plan

The mapping is so direct that you can go in one straight line:

**Week 1 — copy the scaffolding**
1. `bun init` FeedMe project, copy `package.json` deps (drop financial libs)
2. Copy `src/index.ts` (Hono entry) → adapt routes
3. Copy `src/instrumentation.ts` (OpenTelemetry)
4. Copy `src/brain/` (LLM router)
5. Copy `src/lib/` (logger, tracing, resilience, observability, shutdown)
6. Copy `src/config/` + `src/middleware/`
7. Copy `src/services/redis-dedup.ts`, `credit-gate.ts`, `token-recorder.ts`

**Week 2 — agents and MCPs**
8. Copy `src/agents/supervisor.ts` → fork ×3 (customer-facing, kitchen, inventory)
9. Copy `mcp-servers/shared/` + `chat-now/`
10. Build `mcp-servers/pos/`, `kitchen-display/`, `payment/`, `supplier/` using `chat-now/` as template
11. Copy `.claude/skills/` → adapt directory contents to restaurant scenarios

**Week 3 — eval, channels, ops**
12. Copy `promptfooconfig.yaml` + `evals/` → write FeedMe golden-set scenarios
13. Copy `src/whatsapp-web/` + relevant `src/api/webhooks/`
14. Copy `grafana/` + `prometheus/` + `docker-compose.yml`
15. Wire MemGC into all 3 agents replacing the memory-via-tools pattern

---

## Gotchas / Limitations

1. **Supervisor.ts is 757 lines and has 17 helper functions.** It's manageable but dense. When forking ×3, refactor first into shared `agent-base.ts` + 3 thin per-agent files. Otherwise you triple the maintenance surface.

2. **Brain.runSync timeout is 120s** (line 497). For FeedMe's customer-facing path you want this much shorter (~30s). For Kitchen Agent processing a complex order, keep it longer.

3. **MCP servers HEALTHCHECK pre-flight blocks every request.** Line 571-581. For latency budgets, cache health for ~5s instead of checking every turn — or move the check into the circuit breaker's polling thread.

4. **Tenant_files for skills loading is fetched over HTTP** (lines 113-134). That's a remote dependency on chat_now's API. For FeedMe's MVP, just load skills from local filesystem — drop the HTTP indirection.

5. **`X-Internal-Service` + `X-Internal-Secret` headers** (line 115) — service-to-service auth pattern. Lift this for FeedMe but **generate a fresh secret**.

6. **No tests in `ai_brain/` (visible at top level — promptfooconfig is the eval, not unit tests).** Tests are at the eval level only. Worth augmenting with Bun unit tests around the supervisor message-loop helpers.

7. **Multi-channel webhook dedup via Redis** (`src/services/redis-dedup.ts`) — same message can arrive twice from WhatsApp. Critical for FeedMe order flow — copy this.

8. **Cost recording is fire-and-forget for `recordTokenUsage` but awaited for `deductCreditsViaApi`** (lines 619-653). The reasoning: billing must not be lost, telemetry can be lossy. Match this pattern in FeedMe.

9. **No first-class agent-to-agent communication.** ai_brain is single-supervisor. FeedMe's 3 agents need Kafka or similar. Bring your own event bus.

10. **Brain has both `run()` (streaming) and `runSync()` (non-streaming).** Use streaming for kiosk/web (for snappier UX), runSync for Kitchen and Inventory (they don't need to stream — just trigger the action).

---

## One-paragraph elevator pitch

ai_brain is a Bun + Hono + Promptfoo + Brain LLM-router contact-centre platform serving 10 channels via webhooks, talking to 5 MCP servers (chat-now + EasyStore + admin-crud + admin-research + admin-reports), with HITL approval, circuit-breaker resilience, OpenTelemetry → Grafana observability, and per-tenant credit billing. **It's structurally the same shape as FeedMe** — just swap `search_products`/`get_cart`/`generate_checkout_url` for `search_menu`/`build_order`/`process_payment`, fork the Supervisor into three agents, and lift the entire `mcp-servers/chat-now/` template for every FeedMe MCP server. **The biggest single win: lift `promptfooconfig.yaml` + `evals/` directory verbatim and you have a 155-test golden-set scaffold for FeedMe day one.**

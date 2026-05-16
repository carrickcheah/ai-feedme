# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A working **prototype for the FeedMe (MY/SG F&B SaaS) "Lead Agentic AI Engineer" interview demo**, NOT production code. Single-tenant, SQLite everywhere, web-only (no WhatsApp), built solo. Scope decisions are intentional — don't try to "fix" them by adding Postgres, multi-tenancy, or production hardening unless explicitly asked. See `docs/PLAN.md` for the locked decisions table.

The target architecture is `feedme_agent_architecture_v8.svg` — every box in that SVG maps to existing code. New work should preserve that mapping.

## Commands

```bash
# Day-to-day
bun run dev                    # watch mode, port 8002 (main app)
bun run typecheck              # tsc --noEmit; fast, run after most edits
bun test                       # Bun's built-in test runner
bun run mcp:all                # boot all 4 MCP servers concurrently

# Infra (Redis + Kafka + memgc-service)
bun run infra:up               # or: make up
bun run infra:down             # or: make down
bun run infra:reset            # destroys SQLite-on-volume data
make memgc:up                  # start MemGC Python sidecar locally on :8003 (background)

# Evals
bun run eval                   # full 30-test suite (~60s, ~$0.30 Azure)
bun run eval:happy             # one suite for fast iteration
bun run eval:view              # open Promptfoo HTML dashboard

# Frontend (the kiosk UI)
cd snow-dessert && bun run dev # opens browser; click "AI Assistant" bubble
```

**Always `bun run`, never `bunx`/`npm`/`npx`/`pnpm`** — except the eval scripts, which use `npx --no-install promptfoo` deliberately (see Gotchas).

## Architecture pillars

### 1. Three agents on one shared loop

`src/agents/agent-base.ts` exports `runAgent()` — the multi-turn tool-calling loop that does LLM call → tool dispatch → repeat. The three agents (`customer-facing.ts`, `kitchen.ts`, `inventory.ts`) are thin (~80–140 line) wrappers that supply:

- a job-specific system prompt
- an `allowedMcpServers` array (security boundary — the agent literally cannot call tools outside this set)
- `maxAgentTurns` + `maxCompletionTokens`
- an optional `memoryContext` string injected as `<memory>…</memory>`

When adding a new agent or changing behaviour, prefer editing the wrapper over forking the loop. Span instrumentation, cost accounting, and tool dispatch all live in the base.

### 2. Event-driven agents use the "synthetic prompt" trick

Kitchen and Inventory are not chat-driven; they're triggered by `order.created` and `ingredient.consumed` events. Their handlers convert the event payload into a natural-language paragraph + a structured `Compact form for tool args:` line, then feed it as `userMessage` into the same `runAgent()` loop. This is why one `runAgent` code path serves both chat agents and event-handler agents.

Read `docs/AGENT_FLOW_KITCHEN_INVENTORY.md` and `docs/agent_flow_kitchen_inventory.svg` before editing kitchen/inventory.

### 3. LLM for intent, TypeScript for fan-out

In kitchen.ts and inventory.ts, the agent calls the relevant MCP tools (e.g. `supplier__record_ingredient_consumption`), then the **handler** queries the resulting SQLite state and decides which downstream events to publish. Don't try to parse "publish N events" out of the LLM's output — query `supplier.db` / `pos.db` and emit typed events from TypeScript. Determinism for typed contracts; LLM for ambiguous reasoning.

### 4. Kafka with in-process fallback

`src/events/publisher.ts` tries Kafka first (3s connect timeout); if unreachable, it directly invokes the in-process handler. The handler signature is identical either way. **This is why the demo works without `make up`.** When adding a new event:

1. Add the typed payload to `src/events/types.ts`.
2. Add a `publishX()` function in `publisher.ts` whose fallback dispatches to the in-process handler.
3. Add a Kafka consumer in `src/events/consumers.ts` that calls the same handler.

Both paths converge on the same handler — never write event-bus-specific business logic.

### 5. MCP servers are HTTP JSON-RPC, not stdio

Each MCP server in `mcp-servers/{pos,kitchen-display,payment,supplier}/` runs as a tiny Hono server. The client (`src/brain/mcp-client.ts`) calls them over HTTP with the `server__tool` naming convention (e.g. `pos__search_menu`) which is what the LLM sees in `tools_called`. Multiple MCP servers open the same SQLite file (e.g. KDS and Supplier read `pos.db`) — this works because SQLite WAL allows concurrent readers.

Ports: POS=4001, KDS=4002, Payment=**4013**, Supplier=**4014** (4003/4004 conflict with sibling `ai_brain` Docker containers on dev machines — see Gotchas).

### 6. MemGC is a Python sidecar, not a TypeScript module

`memgc-service/service.py` is a FastAPI server that wraps `memgc-py` (PRISM agentic retrieval: Analyzer → Selector ↔ Adder → Generator → Verifier). TypeScript talks to it via `src/memgc-client.ts` over HTTP with a Redis cache (300s TTL, keyed by `sha256(question)`). First call is cold (~30s + ~$0.05/call); cached calls are instant.

Don't try to port memgc-py to TypeScript — it's an entire 4-agent retrieval loop.

### 7. Langfuse Cloud via OTLP, not the Langfuse SDK

`src/instrumentation.ts` configures `@opentelemetry/sdk-node` with `OTLPTraceExporter` pointed at `${LANGFUSE_BASE_URL}/api/public/otel/v1/traces` with HTTP Basic auth. This is why we don't depend on the `langfuse` npm package — Langfuse Cloud accepts OTLP directly.

**`import "./instrumentation"` MUST be the first import in `src/index.ts`** before the openai SDK is loaded, otherwise its internal fetch isn't patched and LLM calls won't be traced.

Use `traced(name, attrs, fn)` from `src/lib/tracing.ts` for new spans. Auto-instrumentation catches HTTP; manual spans turn raw timing into narrative.

### 8. Azure GPT-5.5 has quirks worth knowing

- Uses `max_completion_tokens`, NOT `max_tokens` — the OpenAI SDK still accepts the old name silently then ignores it. Always use the explicit field.
- Supports `reasoning_effort: "none" | "low" | "medium" | "high"`. `"medium"` consumes the entire completion budget as hidden reasoning tokens for short replies — defaults are `"none"` for all 3 agents. Don't bump unless you know why.
- Azure Content Safety filters input/output. Some red-team eval cases get empty outputs — the eval framework treats this as PASS (defense-in-depth).
- One Azure deployment serves all 3 agents AND Promptfoo's rubric grader — single external dependency.

Config lives in `src/config/env.ts` (Zod-validated). Per-agent settings via `agentConfig(name)`.

## Project layout (the parts that matter)

```
src/
  index.ts                  ← Hono entry; instrumentation FIRST import
  instrumentation.ts        ← OTel SDK → Langfuse Cloud (OTLP)
  config/env.ts             ← Zod env schema + agentConfig() resolver
  brain/                    ← LLM client (Azure) + MCP HTTP client + tool adapters
  agents/
    agent-base.ts           ← runAgent() — the shared multi-turn loop. Edit carefully.
    customer-facing.ts      ← synchronous; HTTP-triggered
    kitchen.ts              ← async; order.created → ingredient.consumed
    inventory.ts            ← async; ingredient.consumed → stock.low
  events/
    publisher.ts            ← Kafka OR in-process fallback (same handler)
    consumers.ts            ← Kafka consumers (when broker is up)
    86-propagator.ts        ← pure SQL — stock.low → menu_item.is_available=0
    types.ts                ← typed event envelopes (see docs/SCHEMAS.md §2)
  memgc-client.ts           ← HTTP wrapper for memgc-service with Redis cache
  lib/tracing.ts            ← traced() + addSpanAttrs() span helpers
  api/chat.ts               ← /api/chat/sync endpoint
mcp-servers/{pos,kitchen-display,payment,supplier}/
  index.ts                  ← Hono JSON-RPC server
  tools.ts                  ← tool definitions + handlers
  schema.sql + client.ts    ← SQLite schema + bun:sqlite client
memgc-service/              ← Python FastAPI sidecar (uv-managed)
snow-dessert/               ← React kiosk UI (no build step — CDN Babel)
evals/golden-set/           ← 30 Promptfoo cases, 4 yaml suites
data/                       ← SQLite files (pos.db, supplier.db, kitchen.db, memgc.sqlite)
docs/                       ← all documentation; see docs/README.md for reading order
```

## Gotchas (things that have already burned time)

- **`bunx promptfoo` fails** with "better-sqlite3 not supported in Bun." Eval scripts use `npx --no-install promptfoo` instead. Don't change this.
- **`bun:sqlite`'s multi-statement `.exec` method** trips a security hook that blocks the tool call. Use `db.run("PRAGMA …")` per-statement instead. Affects schema.sql loaders.
- **MemGC HuggingFace rate-limit**: BGE-M3 download is rate-limited for unauthenticated requests. `memgc-service/service.py` sets `HF_HUB_OFFLINE=1` and `TRANSFORMERS_OFFLINE=1` after the model is cached locally. Don't remove these — first run downloads, subsequent runs need offline mode.
- **Stale `bun src/index.ts` processes** can hold port 8002 silently after a watch crash. If a new `bun run dev` exits without printing anything, run `pkill -9 -f "bun src/index"` first.
- **`.env` sourced by bash** (in eval scripts): values with spaces MUST be quoted. `RESTAURANT_NAME="IceYoo Desaru"` not bare.
- **`z.coerce.boolean()` is a footgun** — any non-empty string (including `"false"`) coerces to `true`. Boolean env vars in `src/config/env.ts` use an explicit string→bool transform.
- **Promptfoo `transformResponse: "json"`** sets output to the literal string `"json"`, not parsed JSON. Omit the line; default behaviour parses correctly.
- **Promptfoo's llm-rubric defaults to OpenAI** — configured `defaultTest.options.provider` to `azureopenai:chat:gpt-5.5` in `promptfooconfig.yaml` so it doesn't need `OPENAI_API_KEY`.

## What not to add

Read `docs/PLAN.md` "Locked decisions" before suggesting any of these:

- **Postgres / pgvector** — single-tenant SQLite is intentional. Don't migrate.
- **Multi-tenancy / RLS** — out of scope for the prototype.
- **WhatsApp / Baileys** — web kiosk only.
- **Real payment integrations** — Payment MCP returns stubs.
- **Tax / SST computation** — `SST_PERCENT=0` is intentional.

If the user later wants any of these, they're a separate phase, not a refactor.

## Demo prep

`docs/DEMO_SCRIPT.md` is the 1-page interview walkthrough. Three wow moments: VIP recognition (Sarah toggle in UI), event-driven auto-86 chain, live Promptfoo eval run. The fallback table covers the 5 likely demo failure modes — if anything looks slow or broken during a demo, narrate it ("this is the cold-start path; warm calls hit Redis cache") rather than stalling silently.

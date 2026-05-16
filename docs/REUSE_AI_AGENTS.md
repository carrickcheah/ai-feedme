# Reusing `ai-agents` for FeedMe

> **Source**: `/Users/carrickcheah/Project/root_ai/ai-agents`
> **Status**: Most mature project. Multi-tenant SaaS, Phases 0–10 shipped, 75 passing tests.
> **Verdict**: The architectural backbone. Borrow the patterns; some pieces lift wholesale.

---

## Project Purpose

Personal AI agent platform — "OpenClaw-as-a-Service, Manus for everyone". One user signs up, gets a private AI agent with its own memory, skills, channel integrations (WhatsApp/Telegram/Discord/Slack/LINE/Zalo/FB Messenger), and scheduled automation. Multi-tenant SaaS — pool model with per-user filesystem isolation under `/data/tenants/{accountId}/`. Mirrors the OpenClaw open-source agent runtime adapted for SaaS.

For FeedMe, the relevant insight is that this is a **production-grade single-agent-per-tenant** architecture. FeedMe needs **three coordinated agents per tenant (restaurant)** — but the per-tenant isolation, channel adapters, memory loaders, Brain module, scheduler, observability, and Skills system are all directly applicable.

---

## Tech Stack

| Layer | Choice |
|---|---|
| Runtime | **Bun 1.3.13** (no build step) |
| Language | TypeScript |
| HTTP | `Bun.serve` + **Hono** |
| DB | `bun:sqlite` + **sqlite-vec** + **FTS5** (per tenant) |
| Search | Hybrid vec + BM25 + RRF fusion (`src/search/`) |
| Embeddings | OpenAI `text-embedding-3-large` (1536-d) |
| LLM | Custom **Brain** module — 8 providers with fallback (Anthropic, OpenAI, Azure, DeepSeek, Qwen, Bedrock, Gemini, +) |
| Channels | WhatsApp Web (Baileys), Telegram, Discord, Slack, LINE, FB Messenger, Instagram, Zalo, Web Widget |
| Scheduler | `croner` + Redis queue |
| Sandbox | Docker ephemeral per bash call (openshell-compatible) |
| Observability | OpenTelemetry — traces + metrics OTLP |
| Auth | Internal JWT (`jose`), TOTP (`otpauth`) |
| UI | React + Vite + TanStack Query + Tailwind + shadcn |
| Proxy | Caddy auto-TLS |
| Deployment | Azure VM + Docker Compose |

Notable: `@anthropic-ai/sdk`, `openai`, `croner`, `ioredis`, `sqlite-vec`, `zod`, `ulid` — no MCP SDK because they ship their own MCP-style HTTP JSON-RPC client (`src/brain/mcp-client.ts`).

---

## Directory Structure

```
ai-agents/
├── agents/                      # ← Bun backend (the meat)
│   ├── src/
│   │   ├── agents/              # Agent registry + per-agent loops
│   │   ├── api/                 # Hono routes (webhooks, settings, internal)
│   │   ├── brain/               # 🔥 LLM provider router (8 providers)
│   │   │   ├── providers/
│   │   │   ├── runner.ts        # Streaming runner
│   │   │   ├── compaction.ts    # Session-history JIT summarizer
│   │   │   └── tools/           # bash + load_skill schemas
│   │   ├── clawagen/            # CLI dispatcher (17 nouns, ~55 verbs)
│   │   ├── commands/            # Slash-commands (/new, /reset, /compact)
│   │   ├── context/             # ⭐ prompt-builder + 8-file loader
│   │   ├── cron/                # croner-based per-tenant scheduling
│   │   ├── data-sources/        # External integrations
│   │   ├── db/                  # SQLite migrations
│   │   ├── dreaming/            # Memory decay (mirrors MemGC concept)
│   │   ├── embeddings/          # OpenAI embed client
│   │   ├── heartbeat/           # Auto-writes HEARTBEAT.md every 5 min
│   │   ├── indexer/             # File → FTS + vec index writer
│   │   ├── license/             # Ed25519-signed license keys
│   │   ├── memory/              # Tier-2 daily notes (today/yesterday auto-load)
│   │   ├── memory-compactor/    # Nightly LLM-driven MEMORY.md compaction
│   │   ├── memory-flush/        # Pre-flush autosave hook
│   │   ├── messaging/           # 9 channel adapters
│   │   ├── observability/       # OTel exporters
│   │   ├── plugins/             # Tenant-loaded plugin system
│   │   ├── routing/             # Inbound message router
│   │   ├── sandbox/             # Docker bash exec
│   │   ├── scheduler/           # Cron queue
│   │   ├── search/              # RRF hybrid search
│   │   ├── sessions/            # Conversation history JSON store
│   │   ├── skills-catalog/      # Skill manifest loader
│   │   └── updater/             # Self-update mechanism
│   ├── bin/clawagen.ts          # CLI entry
│   ├── tests/                   # 75 passing tests
│   └── data-source-defaults/    # Default tenant files
├── ui/                          # React dashboard
├── channel-oauth/               # Meta Embedded Signup (stub)
├── control-plane/               # Multi-tenant admin
├── caddy/                       # TLS proxy config
├── infra/                       # Azure VM creds (gitignored)
├── docker-compose.yml
├── docker-compose.azure.yml
└── webpages/                    # Landing site
```

The whole product is `agents/` — `ui/`, `caddy/`, `channel-oauth/`, `control-plane/` are peripheral.

---

## Key Components

- **`agents/src/agents/main.ts`** — single-agent runtime entry. Builds system prompt, calls Brain, processes results, handles `/new` `/reset` `/compact` commands, drives memory-flush.
- **`agents/src/agents/registry.ts`** — multi-agent registry. Originally Admin+CS pair; pivoted to single-tenant 2026-04-26 but the registry abstraction survives — **directly usable for FeedMe's 3 agents.**
- **`agents/src/context/prompt-builder.ts`** — assembles per-turn system prompt from 8 markdown files + skills manifest + dynamic context.
- **`agents/src/context/loader.ts`** — 5-min TTL in-memory cache with mtime-aware invalidation. Reads tenant file or repo default.
- **`agents/src/brain/`** — Brain module. Multi-provider fallback chain, streaming + sync, MCP HTTP JSON-RPC client, JIT history compaction at 80k tokens, cost tracker, model resolver.
- **`agents/src/messaging/`** — channel adapter pattern. Each platform is `<platform>/index.ts` + `<platform>/handler.ts`. WhatsApp Web (Baileys 7.0), Telegram, Discord, Slack, LINE, Zalo.
- **`agents/src/cron/`** + **`agents/src/scheduler/`** — Redis-backed per-tenant cron jobs. Croner for crontab parsing, Redis queue for distributed execution.
- **`agents/src/sandbox/`** — Docker ephemeral container per `bash` tool call. Tenant fs mounted read-only except `/data/tenants/{id}/`. Image at `sandbox/image/`.
- **`agents/src/memory-compactor/compactor.ts`** — `MEMORY.md` compaction. 60/40 split, LLM-summarized head + verbatim tail. Threshold 20k chars. Idempotent.
- **`agents/src/clawagen/`** — CLI command dispatcher. The LLM emits `bash "clawagen <noun> <verb> ..."` and this dispatches to handlers. **17 nouns, ~55 verbs.**
- **`agents/src/search/`** — RRF (Reciprocal Rank Fusion) merging vec + FTS5 results. K=60.

---

## 🟢 Directly Reusable

### 1. The Brain module (8-provider LLM router) — `agents/src/brain/`

**Why for FeedMe**: All three agents (Customer-facing, Kitchen, Inventory) need LLM calls with provider fallback. The user's CLAUDE.md says use Claude SDK, but having a fallback chain (Anthropic → Azure → DeepSeek) is production-grade insurance against rate limits.

Lift wholesale. Has streaming via `run()`, sync via `runSync()`, cost estimation via `estimateUsageCost()`, history compaction at 80k tokens, MCP HTTP JSON-RPC client, model resolver.

```typescript
// src/brain/runner.ts shape — copy this signature
export async function runSync(options: BrainRunOptions): Promise<BrainResult>
export async function* run(options: BrainRunOptions): AsyncGenerator<BrainStreamEvent, BrainResult>
```

### 2. The 8-file context model — `agents/context-defaults/` + `agents/src/context/`

**Why for FeedMe**: Restaurants need persistent identity per location. Adapt the file set:

| ai-agents file | FeedMe file | Purpose |
|---|---|---|
| IDENTITY.md | IDENTITY.md | "I am REMY for {restaurant name}" |
| SOUL.md | TONE.md | Brand voice — casual / formal / kawaii |
| USER.md | OWNER.md | Restaurant owner profile |
| AGENTS.md | AGENTS.md | Customer-facing / Kitchen / Inventory catalog |
| TOOLS.md | TOOLS.md | MCP capabilities |
| HEARTBEAT.md | HEARTBEAT.md | Open/close, current queue, 86'd items |
| MEMORY.md | MEMORY.md | Compacted long-term memory (then MemGC will replace this) |
| BOOTSTRAP.md | BOOTSTRAP.md | First-turn priming |
| — | **MENU.md** | New — menu + prices + allergens (RAG-indexed) |
| — | **OPERATIONS.md** | New — kitchen station map, cook times |

`context/loader.ts` and `prompt-builder.ts` are tenant-aware out of the box. **Lift them as-is.**

### 3. Channel adapter pattern — `agents/src/messaging/`

**Why for FeedMe**: FeedMe's frontend is the FeedMe app, but ordering will eventually flow through WhatsApp, Telegram, in-store kiosk, etc. The plugin pattern means adding a new channel = drop a new folder.

Each channel: `<platform>/index.ts` exports `start()`, `handler.ts` exports `handleIncomingMessage(msg)`. The `routing/` directory routes inbound messages to the Customer-facing agent.

Specific channels to lift:
- **WhatsApp Web (Baileys)** — `messaging/whatsapp-web/` + `src/whatsapp-web/` — QR-login + per-tenant socket
- **Telegram** — `messaging/telegram/` — webhook-based
- **Web Widget / kiosk** — `api/streamingApp` — SSE streaming endpoint

### 4. The `prompt-builder.ts` skills XML pattern

Loads skill **names + descriptions only** into the system prompt (~280 tokens for 14 skills), then the LLM calls `load_skill <name>` to pull the full body on demand. **Token-efficient pattern FeedMe should adopt for restaurant skills** (`upsell.md`, `vip_protocol.md`, `allergen_check.md`, `86_item_protocol.md`, `complaint_handling.md`, `comp_drink.md`, etc.).

### 5. Memory compactor — `agents/src/memory-compactor/compactor.ts`

**Why for FeedMe**: Even with MemGC, you'll have per-tenant `MEMORY.md` for high-priority facts ("VIP customer Sarah hates onions"). The 60/40 split + LLM-summarize-head pattern is shipped, tested, idempotent.

### 6. Hybrid search (RRF) — `agents/src/search/`

**Why for FeedMe**: Menu RAG. Customer says "do you have the spicy one with chicken?" — needs vector match for "spicy chicken" + BM25 match for exact item names. RRF (k=60) merges both rankings. Already wired to `bun:sqlite` + sqlite-vec. **Zero external vector DB.** Works offline.

### 7. Heartbeat writer — `agents/src/heartbeat/writer.ts`

5-minute tick, overwrites (doesn't append). Schema is fixed ~220 bytes. For FeedMe restaurants, this becomes: current open/close, items 86'd in last hour, kitchen queue depth, average wait time. **Auto-injected into every turn's system prompt — no LLM call needed.**

### 8. Scheduler + cron — `agents/src/scheduler/` + `agents/src/cron/`

**Why for FeedMe**: Nightly stock reorder, daily sales summary to owner via WhatsApp, hourly cleanup of expired carts, MemGC `dreaming()` cron at 3 AM. All per-tenant. Croner + Redis queue. Ship-grade.

### 9. Observability stack — `agents/src/observability/` + `agents/src/lib/observability/`

OpenTelemetry SDK initialized at startup (`src/instrumentation.ts`-style). OTLP exporters for both traces and metrics. **In-memory metrics collector + alert evaluator** (`src/lib/observability/metrics-collector.ts`, `alert-evaluator.ts`) for the dashboard. FeedMe slots in directly — point OTLP at Langfuse (which speaks OTLP) and you're done.

### 10. Resilience manager — `agents/src/lib/resilience/` (in ai_brain but pattern from here)

Circuit breaker per MCP server. Auto-excludes unhealthy backends from the next tool call set.

---

## 🟡 Needs Adaptation

### Single-agent → 3-agent registry

`agents/src/agents/main.ts` is single-tenant single-agent post-pivot. The `registry.ts` abstraction is the right shape but needs to be wired back for multi-agent. FeedMe should fork `main.ts` into:
- `customer-facing.ts`
- `kitchen.ts`
- `inventory.ts`

Each with its own per-agent context files under `/data/tenants/{restaurantId}/customer-facing/IDENTITY.md` etc. The registry already supports `agentId` discovery from filesystem (`agents/src/agents/discovery.ts`).

### `bash` tool + clawagen CLI → MCP tools

ai-agents uses the **2-tool architecture**: `bash` + `load_skill`. Bash dispatches to clawagen (in-process). FeedMe should drop bash and use **first-class MCP tools** because:
- Restaurant operations are write-heavy (POS commits, KDS sends) — auditability of every tool call matters
- Locked-review actions (`LOCKED_REVIEW_ACTIONS` pattern from ai_brain) work cleanly with named MCP tools

Lift the clawagen *command dispatch* idea but replace `bash` with explicit `mcp__pos__create_order` etc.

### Sandbox

Restaurant agents don't need shell. **Remove the Docker sandbox layer entirely** — saves complexity, latency, and security surface. MCP servers replace it.

---

## 🔴 Not Relevant

- `agents/src/license/` — Ed25519 license keys, for OSS dual-licensing, not needed
- `agents/src/updater/` — self-update for desktop installs
- `channel-oauth/` — Meta Embedded Signup stub
- `webpages/` — landing site
- `caddy/` — replace with FeedMe's existing infra
- `agents/src/plugins/autoload.ts` plugin system — over-engineered for FeedMe's known 3-agent shape (revisit if FeedMe grows custom verticals)

---

## Integration Plan

Three-week lift order:

**Week 1 — backbone**
1. Copy `agents/src/brain/` → FeedMe `src/brain/` (drop unused providers, keep Anthropic + Azure OpenAI)
2. Copy `agents/src/context/` (loader + prompt-builder) — adapt the 8 → 10-file model
3. Copy `agents/src/sessions/`, `agents/src/memory-compactor/`
4. Copy `agents/src/observability/` and `lib/observability/`
5. Wire one stub agent (`customer-facing.ts`) end-to-end

**Week 2 — agents and channels**
6. Fork `main.ts` × 3 → customer-facing / kitchen / inventory agents
7. Copy `agents/src/messaging/` channels (start with web widget + WhatsApp)
8. Wire the registry — `agents/src/agents/registry.ts` + `discovery.ts`

**Week 3 — operations**
9. Copy `agents/src/scheduler/` + `cron/` for stock reorders and nightly tasks
10. Copy `agents/src/heartbeat/` — adapt to restaurant operational state
11. Replace `agents/src/memory/auto-recall.ts` with MemGC `answer()` call (see REUSE_MEMGC.md)
12. Drop `agents/src/sandbox/`, replace clawagen bash with MCP tools

---

## Gotchas / Limitations

1. **`@closed-source` marker on `agents/src/agents/main.ts:21`** — they treat this as their proprietary IP packaged as `@clawagen/agent-core`. Internal use is fine, but if FeedMe ever open-sources, this file needs a rewrite or license clearance.

2. **Tenant-id authority lives in headers**, not the LLM. Look at `chat-now/index.ts:140-167` for the pattern — `X-Account-Id` is the only trusted source. The LLM never sees or supplies it. **Mandatory copy** for FeedMe.

3. **MEMORY.md compactor is idempotent** but you can stack two summaries if the threshold flips repeatedly — it'll re-summarize the already-summarized head. Fine in steady state, but be aware.

4. **The 8-file context model is per-agent, not per-tenant.** For FeedMe's 3 agents, you need 3× the storage (customer-facing/IDENTITY.md, kitchen/IDENTITY.md, inventory/IDENTITY.md). Acceptable.

5. **Bun-specific code**: uses `bun:sqlite`, `Bun.serve`, `Bun.file`. Not portable to Node without rewrites — but matches the user's TypeScript+Bun preference, so this is a feature not a bug.

6. **No tests for the multi-agent path post single-tenant pivot.** Registry exists but is exercised through single-agent now. Re-enabling multi-agent for FeedMe means restoring + writing fresh tests.

7. **75 tests covering core paths.** Run them as the smoke test for any port.

---

## One-paragraph elevator pitch

ai-agents is a Bun + Hono multi-tenant SaaS that runs a personal AI agent per user, with a Brain module routing across 8 LLM providers, a filesystem-first context model (8 markdown files per tenant), nine channel adapters, a Redis-backed scheduler, and per-tenant SQLite with hybrid vec + FTS5 + RRF search. **The three pieces FeedMe should lift verbatim are: the Brain LLM router (`src/brain/`), the context-file loader + prompt-builder (`src/context/`), and the channel adapter system (`src/messaging/` + `src/whatsapp-web/`).** The 8-file model adapts to FeedMe's 3 agents by giving each agent its own context directory, and the bash-tool architecture should be dropped in favor of explicit MCP tools (auditability for restaurant operations).

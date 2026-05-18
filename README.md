# FeedMe — Autonomous Restaurant Agent System

> A working prototype where three AI agents run a small restaurant together — taking orders, scheduling the kitchen, and reordering ingredients on their own.

**Live demo →** [`feedm.carrickcheah.com`](https://feedm.carrickcheah.com/)
&nbsp;&nbsp;·&nbsp;&nbsp; **Stack** Bun · TypeScript · Hono · Azure GPT-5.5 · MCP · Kafka · Redis · Langfuse · SQLite · Docker · Caddy
&nbsp;&nbsp;·&nbsp;&nbsp; **Code** ~4.6k lines of TypeScript + a small Python service
&nbsp;&nbsp;·&nbsp;&nbsp; **Evals** 30 test cases
&nbsp;&nbsp;·&nbsp;&nbsp; **Deploy** Push to main → live in ~35 seconds

---

## What it does

A guest opens the kiosk and chats. Behind the scenes, three agents handle the work:

| Agent | What it does |
|---|---|
| **Customer-facing** | Looks at the menu, recognises returning customers (like Sarah — peanut allergy, VIP), takes the order |
| **Kitchen** | When an order arrives, sends tickets to the right station and tracks which ingredients were used |
| **Inventory** | When ingredients run low, reorders from the supplier |

If an ingredient runs out, every menu item that needs it disappears from the kiosk **automatically** — no human in the loop. That's the headline moment of the demo.

---

## Architecture

![FeedMe architecture](docs/chart_feedme_architecture.svg)

The whole system runs on three simple ideas:

1. **One shared agent loop.** All three agents use the same code (`src/agents/agent-base.ts`). Each one is a small wrapper that says "here's my job and here are the tools I'm allowed to use."
2. **Events with a safety net.** Agents talk to each other through Kafka events. If Kafka isn't running, the same handler runs in-process instead — so the demo works with zero infrastructure.
3. **LLM only where it earns its cost.** Agents reason about messy human input with an LLM. Anything deterministic (which menu items to hide, which event to publish next) is plain SQL or TypeScript.

### Agent flows

Chat triggers the customer-facing agent over HTTP. Orders fire events that wake the kitchen and inventory agents.

![Agent flows](docs/chart_agent_flows.svg)

---

## How it's built

### Each agent only sees the tools it needs

The customer-facing agent can search the menu and take orders. It **cannot** mess with kitchen tickets or supplier orders — the code rejects those calls before they reach an LLM.

| Agent | Tools it can use |
|---|---|
| Customer-facing | menu search, payment |
| Kitchen | menu lookup, kitchen tickets, supplier |
| Inventory | supplier only |

Each tool group lives in its own small server with its own database.

![MCP servers, tools, and databases](docs/chart_mcp_servers.svg)

### Prompts live in plain markdown

The instructions each agent follows are in `.md` files under `src/agents/prompts/`. Edit a file, push, and the new behaviour is live in 35 seconds. No code changes needed.

### Streaming answers

The chat doesn't wait for the full reply before showing anything — words appear as the model generates them, so the kiosk feels instant.

### Every action is traced

Every chat, every tool call, every event lands in **Langfuse Cloud**. You can replay any conversation, see exactly which tools fired, how long they took, and what they cost.

### Memory

A small Python service (`memgc-service/`) remembers facts about customers — their preferences, allergies, past orders — and gives that context to the agent on every chat. Results are cached in Redis so it's fast on the second call.

![Memory lookup flow](docs/chart_memgc_answer_flow.svg)

### One database per agent

Each tool server owns one SQLite file. Multiple readers, one writer. No setup, no migrations, no Postgres ops.

### Tested against real prompts

30 test cases under `evals/golden-set/`, graded by the same model that runs in production. Covers normal use, edge cases, multi-turn chats, and adversarial inputs.

---

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Runtime | **Bun** | Fast, built-in SQLite + tests |
| HTTP | **Hono** | Small, fast, supports streaming |
| LLM | **Azure OpenAI GPT-5.5** | Reasoning mode + content safety |
| Streaming | **Server-Sent Events** | Simple way to push tokens to the browser |
| Events | **Kafka + in-process fallback** | Real event bus, but works without it |
| Memory | **Python sidecar + Redis cache** | Custom retrieval over customer facts |
| Storage | **SQLite** | One file per service, zero ops |
| MCP | **HTTP JSON-RPC** | Standard tool protocol |
| Observability | **Langfuse Cloud** | Every action traced |
| Edge | **Caddy** | Automatic HTTPS |
| Deploy | **Self-hosted GitHub runner** | ~35 second deploys |
| Containers | **Docker Compose** | One file describes the whole stack |

---

## Project layout

```
src/
  index.ts                    Main entry point
  agents/
    agent-base.ts             Shared agent loop
    customer-facing.ts        Handles chat
    kitchen.ts                Handles new orders
    inventory.ts              Handles low stock
    prompts/*.md              Plain-text agent instructions
  events/
    publisher.ts              Kafka or in-process
    86-propagator.ts          Hides menu items when stock runs out
  memgc-client.ts             Talks to the memory service
  api/                        Chat + dashboard endpoints
mcp-servers/                  Four small tool servers (pos, kitchen, payment, supplier)
memgc-service/                Python memory service
snow-dessert/                 The kiosk UI
evals/golden-set/             30 test cases
docs/                         Diagrams + notes
deploy/                       Caddy config + deploy script
```

---

## Quickstart

```bash
# 1. Install
bun install

# 2. Set up environment
cp .env.example .env

# 3. Start everything
bun run mcp:all   # tool servers
bun run dev       # main app

# 4. Open the kiosk
cd snow-dessert && bun run dev
```

The demo runs without Kafka, Redis, or the memory service — they're optional speed boosts.

---

## Evals

```bash
bun run eval         # all 30 tests (~60s)
bun run eval:happy   # quick subset
bun run eval:view    # open results in browser
```

Covers normal orders, multi-turn conversations, edge cases (out-of-stock, unknown items, payment retries), and adversarial inputs (prompt injection, refund manipulation, allergen safety).

---

## Production

The live site runs as five Docker containers — Caddy (proxy + auto-HTTPS), the main app, the tool servers, the memory service, and Redis. A self-hosted GitHub Actions runner deploys every push to `main` in about 35 seconds.

```
push → runner → docker compose up --build → health check → live
```

---

## Diagrams

| Diagram | What it shows |
|---|---|
| [Master map](docs/chart_feedme_architecture.svg) | Full system at a glance |
| [Agent flows](docs/chart_agent_flows.svg) | How a chat triggers each agent |
| [Kitchen + Inventory flow](docs/chart_agent_flow_kitchen_inventory.svg) | The auto-reorder chain |
| [Tool servers](docs/chart_mcp_servers.svg) | MCP servers, their tools, their databases |
| [Memory flow](docs/chart_memgc_answer_flow.svg) | How customer facts are retrieved |

---

## License

Apache 2.0 — built as a portfolio prototype; reuse anything useful.

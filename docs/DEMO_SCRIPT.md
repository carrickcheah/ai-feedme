# Guide

A short tour of what FeedMe is, what it can do, and how it's put together.

**Live demo:** [feedm.carrickcheah.com](https://feedm.carrickcheah.com/) — open the kiosk on the left, click the chat bubble.

---

## What FeedMe is

A working prototype of an AI system that runs a small restaurant on its own.

Three agents collaborate behind the scenes:

| Agent | Job |
|---|---|
| **Customer-facing** | Greets the guest, takes orders from the kiosk |
| **Kitchen** | Sends tickets to the right stations, tracks ingredient use |
| **Inventory** | Reorders supplies and hides menu items when stock runs out |

No central orchestrator tells them what to do — each agent reacts to events. That design is what lets the same code scale from one restaurant to many without a single bottleneck.

---

## Three things to look at

### 1. VIP recognition

The kiosk has a **"Demo: Sarah"** toggle. With it on, the assistant greets her by name and already knows she's peanut-allergic and that her usual order is a Mango Iceyoo.

How: when the chat starts, the customer-facing agent asks a small memory service for everything it knows about Sarah. The service answers in plain English, and that text is injected into the agent's context.

### 2. Automatic stock-out cascade

Place a few Mango Iceyoo orders in a row. Behind the scenes:

1. The customer-facing agent confirms the order.
2. An `order.created` event wakes the kitchen agent, which fires station tickets and records ingredient use.
3. An `ingredient.consumed` event wakes the inventory agent, which checks stock against par level.
4. When stock dips below par, a `stock.low` event fires. Every menu item that depends on that ingredient is marked unavailable.
5. The next time someone tries to order Mango Iceyoo, the assistant says it sold out and suggests an alternative.

No human did anything between steps 1 and 5.

### 3. Evals + observability

Every chat, every tool call, every event is traced in **Langfuse** — open a trace and you can see the agent's full reasoning, which tools it called, how long each step took, and the token cost.

A separate test suite (`bun run eval`) runs 30 cases — normal orders, multi-turn dialogues, edge cases, and adversarial prompts. Each case is graded by the same model the system uses in production.

---

## How it's built

### One shared agent loop

All three agents run the same code (`src/agents/agent-base.ts`). The differences live in three small wrapper files — each says what the agent's job is and which tools it's allowed to use. Adding a fourth agent is a copy-paste, not a refactor.

### Tools are bounded

The customer-facing agent can use the menu and payment tools — it *cannot* touch kitchen tickets or supplier orders. The boundary is enforced by the runtime, not by polite wording in the prompt.

### Events with a safety net

Agents talk to each other over a Kafka event bus. If Kafka isn't available, the same handler runs in-process instead. The demo works either way; production gets durability.

### Memory as a service

Customer facts live in a small Python service that does iterative retrieval rather than a single vector lookup. Results are cached in Redis so repeated lookups are fast.

### Streaming chat

The kiosk shows words as the model generates them — not "thinking…" for three seconds followed by a wall of text.

---

## Stack

```
Frontend     React kiosk (no build step — CDN Babel)
Server       Bun + Hono + TypeScript
LLM          Azure OpenAI GPT-5.5
Memory       Python service + Redis cache
Tools        Four small MCP servers (POS, Kitchen, Payment, Supplier)
Storage      SQLite — one file per service
Events       Kafka (with in-process fallback)
Tracing      Langfuse Cloud
Evals        Promptfoo, graded by the same model
Edge         Caddy with automatic HTTPS
Deploy       Self-hosted GitHub Actions runner — ~35s per deploy
```

---

## Where to look

| | URL |
|---|---|
| Live kiosk | [feedm.carrickcheah.com](https://feedm.carrickcheah.com/) |
| Langfuse dashboard | Every chat appears here within seconds |
| Source | [github.com/carrickcheah/ai-feedme](https://github.com/carrickcheah/ai-feedme) |
| Architecture diagrams | See the **Architecture** pages in this sidebar |

If you only have a minute, click the chat bubble on the live kiosk and ask *"what is my last order?"* — that one interaction touches the menu search, the memory service, customer-specific order lookup, and ends up as a fully-traced span in Langfuse.

# 008 — Runtime Cost

> Harness sub-domain #8 (Tier B, operational). Question it owns: **"How much does it cost to RUN — per reply — and how do I cap it?"**
> (Renamed from "Cost" → "Runtime Cost" to avoid confusion with build cost.)
> Demo tenant: Awesome Healthcare (synthetic data).

## TL;DR — runtime cost = two sides

- **A. Cost to run** — the per-reply token formula + the four input-token levers
  (Code Mode, lazy loading, history limit, zero-LLM recall)
- **B. Charge to client** — credits as how the company bills, with the rule that
  price-per-credit must stay above token cost

## First: which "cost"? (three levels, outside-in)

```
┌─ META / PROJECT level  ──────────────────────────┐
│  "Should we build this? How long? How much?"      │
│  → build cost, team, timeline, ROI                │   ← you wear the planner hat
│                                                    │
│   ┌─ BUILD level (SDLC) ─────────────────────┐    │
│   │  build → test → deploy → monitor          │    │   ← you wear the engineer hat
│   │                                           │    │
│   │    ┌─ RUNTIME level ──────────────┐       │    │
│   │    │  THE HARNESS                  │       │    │   ← the system, while running
│   │    │  tools·context·flow·safety·   │       │    │
│   │    │  memory + runtime cost (#8)   │       │    │
│   │    └───────────────────────────────┘       │    │
│   └───────────────────────────────────────────┘    │
└────────────────────────────────────────────────────┘
```

- **Build cost** lives at the META level — "is it worth making?" → scoped during project planning.
- **#8 is RUNTIME cost** — "now that it's running, what does each reply cost, and how do I cap it?"
- Build cost is paid **once**; runtime cost is paid **per message, forever**. #8 governs the second.

## Runtime cost has TWO sides

| Side | Who pays | What it is |
|---|---|---|
| **A. Cost to RUN** | you (operator) | tokens you pay the LLM provider + a little compute/infra |
| **B. Charge to CLIENT** | the tenant pays you | **credits** — how the software company bills the client |

Both are runtime (paid per reply). The credit system is the **bridge**: credits map to token cost,
so what the client pays stays aligned with what it costs you to serve them.

```
patient reply → burns YOUR tokens (you pay LLM) → deducts TENANT's credits (they pay you)
```

### A. Cost to run — the formula

```
Runtime cost per reply =
   input tokens   (system prompt + skills + history + the patient's message)
 + output tokens  (the AI's reply)
 + tool round-trips (each tool call sends MORE tokens back to the model)
 + a little compute/infra (servers, DB)
```

**Biggest lever = input tokens** — you resend the context every turn. That's why the design matters:

- **Code Mode (23 tools → 2)** → fewer tool definitions sent each call → fewer input tokens
- **Lazy skill loading** → send only the matched skill, not all 25 → fewer input tokens
- **History limit (~40 msgs)** → conversation doesn't grow forever → caps input tokens
- **Memory agent "zero-LLM recall"** → retrieval done by code, not the model → no tokens

> Input usually costs more than output, because every turn re-sends the whole context.
> So: optimize what's IN context, not what comes OUT.

### B. Charge to client — credits (billing)

Credits are the unit the software company charges clients. Each reply deducts credits (`credits.ts`),
gated before the LLM runs, logged in `credit_ledger`. Pricing per credit must stay above token cost
per reply — otherwise the company loses money on every conversation.

## The petrol analogy

A car: buying it = build cost (once). Petrol per trip = runtime cost (every reply). #8 = the petrol bill.
Every reply burns tokens; at 1,000 messages/day that adds up fast. #8 controls it three ways:

- ⛽ **Use less petrol per trip** → fewer tokens per reply (Code Mode: 23 tools → 2, lazy skill loading)
- 🛑 **Stop when the tank's empty** → credit system: no credits, no reply
- 🚦 **One driver can't take all the petrol** → caps so one tenant can't hog resources

## In my repo

| Concern | How it's handled | Where |
|---|---|---|
| 💰 Per-tenant spend | Credit system — each reply deducts credits | `credits.ts` |
| 🔒 Race-safe deduction | `SELECT FOR UPDATE` locks the row so two chats can't overdraw | `credits.ts:116-216` |
| 🚪 Pre-flight gate | check credits *before* calling the LLM; none → canned reply | `credit-gate.ts` |
| 🛟 Service-down safety | credit service down → **fail-open** (let chat through) | `credit-gate.ts:51-73` |
| 🧾 Audit trail | every debit/credit logged with running balance | `credit_ledger` |
| 📦 Load cap | max 20 concurrent agent tasks → 503 | `background-task.ts` |

## Talking points

- The gate runs **before the LLM** — don't spend tokens to discover the tenant is out of credits.
  Cost governance reusing the control-flow funnel (cheap rejection first).
- **Fail-open is a deliberate trade-off**: credit service down → let the patient through, don't block.
  For healthcare, availability > billing accuracy. After 10 consecutive failures it alerts.
- Two layers of cost control: cheaper calls (fewer tokens) + capped budgets (credits).

## Summary (precise)

#8 is *runtime* cost (the petrol), not build cost (the car) — and it has two sides: the **tokens I
pay the LLM** (biggest lever = input tokens, cut via Code Mode + lazy loading) and the **credits the
client pays me** (how the company bills, kept above token cost). My harness gates credits before the
LLM runs (cheap rejection), deducts them race-safely with `SELECT FOR UPDATE`, logs every
transaction for audit, and caps concurrent tasks at 20 — with a deliberate fail-open so a billing
outage never blocks a patient.

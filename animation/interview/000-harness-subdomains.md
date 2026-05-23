# Harness Engineering — The 10 Sub-Domains

> Working notes for interview. Private (gitignored). Demo tenant: **Awesome Healthcare** (synthetic data).

## The hierarchy (how to frame it)

```
AI Engineering  (building anything with LLMs)
│
├─ Prompt Engineering    → one good response
├─ Context Engineering   → what the model sees
└─ Harness Engineering   ◄── MY TOPIC: everything that wraps the agent at runtime
```

Say it as a **progression / ladder** ("each rung handles what the one below can't"), NOT
"AI engineering has exactly 3 domains" — that overclaims and invites a "what about evals?" gotcha.

---

## Tier A — the 5 CORE sub-domains (the runtime control loop)

Use these 5 as the main story.

| # | Sub-domain | Question it owns | In my repo |
|---|---|---|---|
| 1 | **Tools / actions** | What can it *do*? | MCP (strict schema) vs Code Mode (flexible) — trust-tiered |
| 2 | **Context** | What does it *see* this step? | 3-tier skill load from `tenant_files`, per-`account_id`, 60s cache |
| 3 | **Control flow** | Act, ask, retry, or stop? | webhook 6-gate filter (`chat-now.ts:98-209`), `runner.ts` loop |
| 4 | **Guardrails / safety** | What is it *forbidden* to do? | `account_id` overridden server-side (`runner.ts:241-243`), refund block |
| 5 | **Memory / state** | What carries between steps/sessions? | `(account_id, contact_id)` sessions, 3-state model |

## Tier B — the 5 OPERATIONAL sub-domains (wrap the loop)

Pull these out when the CTO digs deeper.

| # | Sub-domain | Question it owns | In my repo |
|---|---|---|---|
| 6 | **Reliability / resilience** | What if a step fails? | provider fallback, 2-min timeout (`runner.ts:254`), MCP health check, session sanitizer |
| 7 | **Observability** | How do I *see* what it did? | OTLP→Grafana, metrics-collector, execution tracer |
| 8 | **Runtime cost** | How much per reply, and how do I cap it? | credit gate + atomic deduction (`SELECT FOR UPDATE`), 20-task concurrency cap (503) |
| 9 | **Human-in-the-loop** | When does a human decide? | action-approvals (auto/review/block), escalate_human, 24h handoff auto-reset |
| 10 | **Evaluation / feedback** | How do I know it's *correct*? | ⚠️ THINNEST area — be honest, name it as next investment |

---

## Key talking points

- **Guardrails are NOT a 6th row** — they're a property woven through ALL sub-domains. That's
  "defense-in-depth": even if one layer is bypassed, the next holds.
- **Killer line (guardrails):** "The model can't pick the tenant — the *server* sets `account_id`.
  The LLM is an input, not an authority." (`runner.ts:241-243`)
- **Honesty framing:** say "I decompose the harness into ~5 core runtime concerns plus operational
  ones" — "I decompose" is my framing, defensible. Don't recite 10 as "the official list."
- **Own the gap (#10 Evaluation):** "My next investment is an eval harness — golden conversations,
  regression scoring." Knowing your own gap = the most senior thing you can say.

## Don't claim (stale / old design — not in current code)

- ❌ `pending_route` + `VALID_AGENTS` allowlist (old agents_bun design)
- ❌ quick-interceptor "skip the LLM" fast path (current `quick-interceptor.ts` only detects language)
- ✅ Real injection defense today: `toolGate` + `LOCKED_REVIEW_ACTIONS` + tenant-ID override

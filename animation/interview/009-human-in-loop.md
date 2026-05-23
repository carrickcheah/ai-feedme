# 009 — Human-in-the-Loop

> Harness sub-domain #9 (Tier B, operational). Question it owns: **"When does a human decide?"**
> Demo tenant: Awesome Healthcare (synthetic data).

## What it is

A **designed checkpoint** — not a failure. The AI runs autonomously, but specific decisions are
routed to a human on purpose. Three exits to a human, by trigger:

| Trigger | Mechanism | Outcome | Where |
|---|---|---|---|
| Risky action (refund / return) | `LOCKED_REVIEW_ACTIONS` + `toolGate` | action **blocked**, queued for approval | `customer-service-agent.ts:56-63` · `action-approvals.ts` |
| Per-action risk policy | tier = **auto / review / block** | tenant chooses; locked actions pinned to `review` | `action-approvals.ts:127-129` |
| AI can't handle the case | `escalate_human` skill → handler = `human` | conversation handed to a person (24h auto-reset to AI) | `escalate_human` skill · `chat-now.ts` handler |

## The one design idea

Risk isn't hardcoded — it's a **per-tenant policy with a floor**:

- **Flexibility:** each tenant sets their own risk appetite per action (auto / review / block).
- **Floor:** dangerous actions are locked to `review` and **cannot be downgraded**, regardless of
  what the tenant configures. The floor is the guarantee; the policy is the freedom.

Example: Awesome Healthcare sets `refund = block` (never automatic); a low-risk shop sets
`refund = auto`. Neither can set a *locked* action below `review`.

## Relationship to #4 Guardrails

Same refund mechanism, two lenses:
- **#4 Guardrails** → *"the AI cannot do this alone."*
- **#9 Human-in-the-loop** → *"a human can approve it."*
The block is the guardrail; the approval queue is the loop.

## Summary (precise)

Human-in-the-loop is a designed checkpoint, not an error path. My harness blocks risky actions for
human approval, exposes per-action risk tiers (auto / review / block) that each tenant configures —
with a non-downgradable `review` floor on dangerous actions — and escalates a conversation to a
human agent (with 24h auto-reset) when the AI can't resolve it.

# 006 — Reliability / Resilience

> Harness sub-domain #6 (Tier B, operational). Question it owns: **"What happens when a step fails?"**
> Demo tenant: Awesome Healthcare (synthetic data).

## Reliability = when something breaks, the AI doesn't die — it has a backup plan.

Things WILL break — the model API times out, an MCP server is down, a session gets corrupted.
Reliability is the set of planned responses so the patient still gets served. The plan isn't always
a *backup* — it can be a backup, a retry, a timeout, or a graceful degrade. Matching the right plan
to each failure is the skill.

## 7 failure points, each with a matched plan

```
┌─────┬────────────────────────────────────────┬──────────────────────────────────────┬────────────────┐
│  #  │        The part that can break         │               Its plan               │   Plan type    │
├─────┼────────────────────────────────────────┼──────────────────────────────────────┼────────────────┤
│ 1   │ Model provider (LLM API)               │ fallback to next model, per-turn     │ 🔄 Backup      │
├─────┼────────────────────────────────────────┼──────────────────────────────────────┼────────────────┤
│ 2   │ Model hangs                            │ 2-min timeout → abort                │ ⏰ Timeout     │
├─────┼────────────────────────────────────────┼──────────────────────────────────────┼────────────────┤
│ 3   │ Loop runs away                         │ 20-turn cap → stop                   │ ⏰ Timeout     │
├─────┼────────────────────────────────────────┼──────────────────────────────────────┼────────────────┤
│ 4   │ MCP server offline                     │ health pre-check before run          │ 🛟 Degrade     │
├─────┼────────────────────────────────────────┼──────────────────────────────────────┼────────────────┤
│ 5   │ Corrupted session (orphaned tool call) │ sanitizer repairs it                 │ ↻ Retry/repair │
├─────┼────────────────────────────────────────┼──────────────────────────────────────┼────────────────┤
│ 6   │ Stale session                          │ retry fresh (no resume)              │ ↻ Retry        │
├─────┼────────────────────────────────────────┼──────────────────────────────────────┼────────────────┤
│ 7   │ Overload (too many requests)           │ concurrency cap → 503, release locks │ 🛟 Degrade     │
└─────┴────────────────────────────────────────┴──────────────────────────────────────┴────────────────┘
```

## Talking points

- 4 kinds of plan: 🔄 Backup (spare exists) · ↻ Retry (might work next time) · ⏰ Timeout (give up
  cleanly when it hangs) · 🛟 Degrade (fail politely when there's no backup).
- The skill is **matching the plan to the failure** — not "retries everywhere" (retrying a refund
  could double-charge). The spread across all 4 plan types is the evidence.
- Honesty: the fallback *mechanism* is built (`runner.ts` walks a per-turn candidate chain via
  `providers.yaml`), but the fallback list is currently single-provider — say "built + configurable,"
  not "running multi-provider in prod."

## Summary (precise)

Reliability = surviving failures, not just the happy path. My harness has seven failure points,
each with a matched plan — per-turn model fallback, timeouts, a loop cap, MCP health pre-checks,
a session sanitizer, stale-session retry, and load-shedding via 503 — so a broken part degrades
gracefully instead of taking the patient's conversation down with it.

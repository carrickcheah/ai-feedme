# 003 — Control Flow

> Harness sub-domain #3. Question it owns: **"Should it act, ask, retry, or stop?"**
> Demo tenant: Awesome Healthcare (synthetic data). Example: Customer Service agent.

## Definition

The decision logic around the agent loop — *when* to invoke the model, *when* to call a tool,
*when* to retry, *when* to stop. The traffic controller around the brain. Front-loaded: cheap
deterministic checks first, expensive non-deterministic LLM last.

## Customer Service agent flow (ASCII)

```
                  ┌──────────────────────────────┐
                  │   Patient message             │
                  │   (Awesome Healthcare)        │
                  └───────────────┬──────────────┘
                                  │
        ════════════ BEFORE THE LLM — 6 gates ════════════
                                  │
                    ┌─────────────▼─────────────┐
                    │ 1. self-message?          │──yes──► 200 ignore
                    └─────────────┬─────────────┘
                                  │ no
                    ┌─────────────▼─────────────┐
                    │ 2. valid payload?         │──no───► 400 invalid
                    └─────────────┬─────────────┘
                                  │ yes
                    ┌─────────────▼─────────────┐
                    │ 3. seen before? (dedup)   │──yes──► 200 duplicate
                    └─────────────┬─────────────┘
                                  │ no
                    ┌─────────────▼─────────────┐
                    │ 4. already running? (lock)│──yes──► 202 skip
                    └─────────────┬─────────────┘
                                  │ no
                    ┌─────────────▼─────────────┐
                    │ 5. human handling it?     │──yes──► skip AI (24h reset)
                    └─────────────┬─────────────┘
                                  │ no
                    ┌─────────────▼─────────────┐
                    │ 6. credits left?          │──no───► canned reply, NO LLM
                    └─────────────┬─────────────┘
                                  │ yes
                    ┌─────────────▼─────────────┐
                    │ return 202 (fire-&-forget)│
                    └─────────────┬─────────────┘
                                  │
                       load session (3-state)
                                  │
                    ┌─────────────▼─────────────┐
                    │ MCP health check?         │──fail─► degrade / error
                    └─────────────┬─────────────┘
                                  │ ok
        ═══════════ INSIDE THE LLM LOOP (≤20 turns, 2-min) ═══════════
                                  │
                    ┌─────────────▼─────────────┐
                    │ read skill (search_know.) │ ◄─────────────┐
                    └─────────────┬─────────────┘               │
                                  │                             │
                    ┌─────────────▼─────────────┐               │
                    │ wants a tool?             │──no──► STOP   │ loop
                    └─────────────┬─────────────┘       (reply) │ again
                                  │ yes                         │
                    ┌─────────────▼─────────────┐               │
                    │ refund? (LOCKED_REVIEW)   │──yes─► BLOCK → human
                    └─────────────┬─────────────┘               │
                                  │ no                          │
                    ┌─────────────▼─────────────┐               │
                    │ execute tool              │               │
                    │ (account_id OVERRIDDEN)   │               │
                    └─────────────┬─────────────┘               │
                                  │                             │
                    ┌─────────────▼─────────────┐               │
                    │ isolation error (-32001)? │──yes─► HARD ABORT
                    └─────────────┬─────────────┘               │
                                  │ no ────────────────────────┘
                                  │
                       (STOP) strip [HANDOFF:*]
                                  │
                  ┌───────────────▼──────────────┐
                  │ send reply  →  save session  │
                  └──────────────────────────────┘
```

## The four decisions, concretely

- **Act?**   only after 6 gates pass AND MCP is healthy
- **Ask?**   gate 5 (human handler) + `toolGate` blocking refunds → human approval
- **Retry?** stale session → re-run without resume; provider fails → fallback model
- **Stop?**  no tool calls, OR 20-turn cap, OR 2-min timeout, OR isolation abort

## Summary (precise)

Control flow decides act/ask/retry/stop. My harness front-loads it — six deterministic guards
reject most work before the LLM ever runs — then bounds the agent loop with stop conditions
(no-tool-call, 20-turn cap, 2-min timeout, isolation-abort) and a stale-session retry, all behind
a fire-and-forget 202. Cheap checks first, expensive model last.

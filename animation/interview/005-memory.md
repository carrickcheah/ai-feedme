# 005 — Memory / State

> Harness sub-domain #5. Question it owns: **"What does the agent carry between steps and sessions?"**
> Framing: abstract architecture I designed — planned to bring onto this platform.

## What memory is

Without memory the agent is a goldfish — it forgets everything after each message.
Memory is what lets it remember the patient across a conversation, and across days.

Two parts: **WHERE** it's stored (tiered layers) and **HOW** it's retrieved (a memory agent).

## WHERE — memory is tiered, not one box

Memory is split by access pattern — each layer chosen for a different cost / latency / scale trade-off:

| Layer | Stores | Why this one |
|---|---|---|
| **SQLite + sqlite-vec** | Agent memory | Local, fast, embedded. The agent's own working + long-term memory with vector search — low latency, no network hop |
| **Postgres** | Company data | Relational source of truth (contacts, orders, records). Strong consistency, joins, transactions |
| **Qdrant** | Big-volume / complex datasets | Dedicated vector DB for scale — when semantic search outgrows sqlite-vec |

> Hot + local (SQLite) · authoritative + relational (Postgres) · large + semantic (Qdrant).

## HOW — a dedicated memory agent retrieves it (answer pipeline)

```
Question
  │
1 Analyzer (LLM)      → split into 1–5 sub-questions
  │
2 Recall (CODE only)  → entity extract → SQL filter → vec+BM25 (RRF) → reranker
  │                     funnel ~1000 → 700 → 300 → top 150   (~500–800ms, ZERO LLM cost)
  │
3 Selector ⇔ Adder    → LLM loop picks 5–25 memories, early-exit after Round 1 (Lever 1)
  │
4 Generator ×7 + Vote → 7 parallel drafts, vote by clustering (vote = code)
  │
5 Verifier (LLM)      → checks 9 failure modes → PASS / REGENERATE / SKIP (Lever 2)
  │
Answer + supporting memories [5–25]
```

## Why this is good harness engineering

- **LLM only orchestrates; local embedder + reranker do the heavy lifting.** Recall (Step 2) and
  Vote (Step 4) are pure code → **zero LLM cost**. The model is used only where judgment is needed.
- Same philosophy as the control-flow funnel: **cheap deterministic work first, costly model last.**
- **Step 5 Verifier = a guardrail** (safety net over 9 failure modes) → memory ties back to #4 Guardrails.
- **Early-exit levers** (skip Round 2, skip Verifier on unanimous vote) = control-flow cost optimization.

## Summary (precise)

Memory is tiered storage — SQLite for agent memory, Postgres for company truth, Qdrant for scale —
retrieved by a dedicated memory agent in which the LLM only orchestrates while local models do the
heavy lifting: recall and voting cost zero LLM tokens, and a verifier guards the final answer.
This is the architecture I'd bring to the platform.

# Reusing `memgc` for FeedMe

> **Source**: `/Users/carrickcheah/Project/root_ai/memgc/memgc-py`
> **Status**: Own build, v0.4.0a1 alpha. 42 tests passing, mypy strict, ruff clean. Apache 2.0.
> **Verdict**: **The memory backbone of FeedMe.** Pip-install it, point at SQLite/Postgres, done.

---

## What This Is

The user's own Python implementation of MemGC — an AI memory library. v0.4.0 alpha. Not a fork; not vendored from someone else. This is the project the user is actively building and shipping (their own repo, their own LICENSE, their own RALPH_PROMPT, CHANGELOG, 31KB README, 26KB CLAUDE.md). The benchmark numbers in the marketing copy (LoCoMo conv-1 74.1%, 81.6× cheaper on history-grow workloads) are theirs.

For FeedMe, this means **you own the memory stack end-to-end** — no third-party dependency risk, no licensing surprise, and customizations are a PR away.

---

## Tech Stack & Dependencies

| Layer | Choice |
|---|---|
| Language | Python (3.x — `tiktoken`, type hints, `Protocol`) |
| Package mgmt | **uv** (`uv.lock`, `uv add memgc` install) |
| Storage backends shipped | **sqlite-vec + FTS5** (today) |
| Storage backends planned | Postgres+pgvector, Qdrant, Pinecone (v0.4+ + community) |
| LLM clients | Azure OpenAI (default), OpenAI, DeepSeek, Cerebras, Ollama |
| Embeddings | **BGE-M3** (local, default, MPS on M-series), text-embedding-3-large (Azure/OpenAI) |
| Reranker | **BAAI/bge-reranker-v2-m3** (cross-encoder, local default, ~200-500ms) |
| Tokenizer | tiktoken-rs (UTF-8 boundary safe) |
| Tests | pytest, 42 passing |

All major heavy lifting (embed, rerank) defaults to **local models on M-series silicon** — no API calls except the actual LLM. That's a huge cost win.

---

## Directory Structure

```
memgc/
├── memgc-py/                     # ← The Python package
│   ├── src/memgc/
│   │   ├── __init__.py           # Public API export (5 symbols + types)
│   │   ├── memgc.py              # ⭐ MemGC class — 299 lines, the public surface
│   │   ├── extract.py            # extract() — atomic-fact extractor + entity index
│   │   ├── consolidate.py        # consolidate() — YAML AgentState compressor
│   │   ├── dreaming.py           # dreaming() — decay-scored GC
│   │   ├── schema.py             # ⭐ Memory / Answer / DreamStats / Status dataclasses
│   │   ├── storage.py            # Storage class — sqlite-vec + FTS5 backend
│   │   ├── rerank.py             # CrossEncoderReranker (bge-reranker-v2-m3)
│   │   ├── entity.py             # Entity extraction (regex, spaCy port)
│   │   ├── agent/
│   │   │   └── prism.py          # ⭐⭐ PRISM agentic loop — 1183 lines
│   │   ├── llm/
│   │   │   ├── base.py           # LlmClient Protocol
│   │   │   ├── azure_openai.py
│   │   │   ├── deepseek.py
│   │   │   ├── cerebras.py
│   │   │   └── ollama.py
│   │   ├── embedding/
│   │   │   ├── openai.py         # Embedder.from_env() — text-embedding-3-large
│   │   │   └── bge.py            # BgeEmbedder — local default
│   │   └── prompts/              # Prompt templates per stage
│   ├── examples/
│   │   └── locomo_conv1.py       # Bench script
│   ├── tests/                    # 42 pytest tests
│   ├── pyproject.toml
│   └── uv.lock
├── docs/
│   ├── architecture/             # Architecture decisions
│   ├── decisions/                # ADRs
│   ├── plans/                    # Roadmap
│   ├── validation/               # Cost-and-latency proofs
│   ├── superpowers/              # Internal playbooks
│   └── logs/                     # Bench output captures
├── webpages/                     # Marketing site
├── README.md                     # 31KB
├── CLAUDE.md                     # 26KB
├── CHANGELOG.md
├── LICENSE                       # Apache 2.0
└── RALPH_PROMPT.md
```

---

## Public API (as actually implemented)

From `src/memgc/__init__.py`:

```python
from memgc import MemGC, Answer, DreamStats, Memory, ScoreWeights, Status
from memgc import DEFAULT_HALF_LIFE_DAYS, DEFAULT_THRESHOLD

__version__ = "0.4.0a1"
```

### `MemGC.open(path, ...) -> MemGC`

```python
@classmethod
def open(
    cls,
    path: str | Path,
    embedder: Embedder | None = None,           # default: BgeEmbedder (local)
    llm: LlmClient | None = None,                # default: AzureOpenAIClient.from_env()
    reranker: Reranker | None = None,            # default: CrossEncoderReranker
    analyzer_llm: LlmClient | None = None,       # optional override for Analyzer stage
    verifier_llm: LlmClient | None = None,       # optional override for Verifier stage
) -> MemGC
```

Lazy-loaded — first method call triggers model downloads (~2.3GB reranker, ~few-hundred MB BGE). After that, ~50ms per embed. Use `MemGC.open(...)` as classmethod, never bare `__init__`.

### `mc.extract(messages, session_date=None) -> list[str]`

Distills atomic facts from a transcript, dedups by SHA-1, writes to storage. Returns the IDs of newly stored memories.

```python
mc.extract([
    {"speaker": "Sarah", "text": "I always order the Mushroom Swiss"},
    {"speaker": "Sarah", "text": "No onions please"},
])
```

### `mc.consolidate(messages) -> str`

Compresses a noisy transcript into a dense **YAML AgentState** string. NEVER persisted; regenerate on demand. Use as the system prompt seed for the next session.

### `mc.dreaming(threshold, half_life_days, *, weights, dry_run) -> DreamStats`

Decay-score every active memory and archive cold rows. Pure math (no LLM). Returns:

```python
DreamStats(scanned=1002, archived=104, kept=898, archived_ids=[...], elapsed_s=0.04)
```

Default threshold 0.05, default half-life 90 days. `dry_run=True` to preview without writing.

### `mc.answer(question, *, k_pool, n_iterations, n_samples, use_reranker, verbose, trace_path) -> Answer`

The big one. PRISM agentic loop:

```
Analyzer  →  entity-filtered recall  →  Selector ⇔ Adder × 3  →  Generator (N=7 self-consistency)  →  Verifier
```

Returns `Answer` with:
- `.text` — synthesized answer
- `.memories` — supporting evidence (list of `Memory`)
- `.elapsed_s` — wall-clock seconds
- `.tokens` — `{"input": N, "output": N}`
- `.mode` — "agentic" or "fast" (mode auto-router)

`str(answer) == answer.text`.

### `mc._recall(query, k, *, speaker, entity_ids, entity_hops) -> list[Memory]`

**Private.** Hybrid vec+BM25 fused via RRF. The PRISM loop uses this internally. Public consumers go through `answer()`.

---

## The PRISM `answer()` Loop

**Entry**: `mc.answer(question, ...)` in `memgc.py:207-250` instantiates `PrismAgent` and calls `.answer(question)`.

**Implementation**: `src/memgc/agent/prism.py` — **1183 lines**. The biggest file in the codebase.

**Pipeline** (per the README):

```
1. Analyzer (1 LLM call)
     ↳ Parse the question, extract entities, choose mode
2. Entity-filtered recall (NO LLM — pure SQL + vec)
     ↳ JOIN entity_memory ON memories tagged with entities
     ↳ Then vec + BM25 fused via Reciprocal Rank Fusion (k=60)
     ↳ Cross-encoder reranker (bge-reranker-v2-m3) over top-N
3. Selector ⇔ Adder × N=3 iterations (2 × 3 = 6 LLM calls)
     ↳ Selector picks the most relevant memories
     ↳ Adder asks "any other context I need?" — re-recalls if so
4. Generator (N=7 self-consistency, 7 parallel LLM calls)
     ↳ 7 candidate answers generated in parallel
     ↳ Jaccard cluster vote — pick the centroid answer
5. Verifier (0-1 LLM call)
     ↳ Optional final pass to filter hallucinations
```

**LLM call count**: 1 + 6 + 7 + 1 = **15 LLM calls per answer in the worst case** (typical: 10-13). README quotes "up to 80s" for complex queries. **This is why Redis cache in front is non-negotiable for FeedMe's hot path.**

**Cost win**: per-stage LLM override (`analyzer_llm`, `verifier_llm`) routes the 2 cheap JSON-shaped calls to a small/fast model (e.g. local Ollama), keeping Sonnet only on Selector+Adder+Generator. See `memgc.py:88-98`.

**Where to dig in `prism.py`**:
- Analyzer prompt: search for `analyze` or `Analyzer`
- Entity-filter: `_recall` invocation with `entity_ids=...`
- Self-consistency vote: search for `n_samples` or `jaccard`
- Verifier: search for `verifier`

---

## Storage Layer

**Implemented today**: `sqlite-vec + FTS5` via `storage.py` (533 lines).

**Schema** (`schema.py`, 112 lines) — main tables you'd see:
- `memory` — content, embedding (vec), status (active/archived), version, lineage_id, created_at, last_accessed_at, recall_count
- `entity` — extracted entities with type
- `memory_entity` — many-to-many join (this is what powers entity-filtered recall)
- `entity_edge` — entity graph (v0.3.7 HyperRAG, for multi-hop)
- FTS5 virtual table for BM25
- sqlite-vec virtual table for cosine similarity

**Backend status**:
- ✅ sqlite-vec — **shipped**
- 🛠️ Postgres + pgvector — **v0.4 planned, schema design in `docs/`**
- 🔌 Qdrant / Pinecone / Weaviate — community via `Storage` Protocol

**For FeedMe**: start with SQLite per restaurant (file under `/data/tenants/{restaurantId}/memgc.db`). When you outgrow ~500K memories, migrate the schema to Postgres+pgvector. The 5-method API is identical across backends — your agent code doesn't change.

---

## `extract()`, `consolidate()`, `dreaming()` — brief

### `extract()` — `src/memgc/extract.py`

- Receives `list[{"speaker": str, "text": str}]`
- LLM prompts an atomic-fact extractor with a SKIP sentinel for small talk
- Each extracted fact gets SHA-1 hashed (verbatim dedup), embedded, entities extracted
- Writes via `Storage.insert_memory(...)`. Race-safe via `UNIQUE(scope, content_hash)` partial index
- Returns list of new memory IDs

### `consolidate()` — `src/memgc/consolidate.py`

- Middle-truncation pre-pass: if input > some token budget, keep 30% head + 30% tail, drop middle, splice marker
- UTF-8 boundary-safe (walks slice boundaries inward up to 4 tokens to preserve CJK/emoji)
- Single LLM call to produce dense YAML AgentState
- Compression ratio: ~2.6×–4×
- **Output is never persisted** — designed to be re-generated as needed and seeded into the next session's system prompt

### `dreaming()` — `src/memgc/dreaming.py`

Decay-score every active memory. v0.4.0 formula (4 components, weighted sum, defaults):

```
score = 0.40 · frequency_signal     # log1p(recall_count) / log1p(10)
      + 0.30 · recency_signal       # exp(-ln(2) · age_days / 90)   ← true half-life
      + 0.20 · consolidation_signal # min(version, 6) / 6
      + 0.10 · conceptual_signal    # min(linked_entity_count, 6) / 6
```

Memory scoring **strictly below threshold 0.05** is archived (status flip — not deleted; audit trail preserved). Default half-life 90 days.

Override weights with `ScoreWeights(frequency=0.5, recency=0.3, ...)`. Preview with `dry_run=True`.

**Pure math, NO LLM call** per memory. Cheap to run nightly via cron.

---

## 🟢 How to Integrate into FeedMe

### Install

The library isn't on PyPI yet (M9 in progress per README line 105-107). So FeedMe will integrate via **local path**:

**Option A — uv workspace** (if FeedMe is Python or has a Python service):

```toml
# In FeedMe pyproject.toml
[tool.uv.sources]
memgc = { path = "../memgc/memgc-py", editable = true }

[project]
dependencies = ["memgc"]
```

**Option B — symlink / sys.path** (quickest):

```python
import sys
sys.path.insert(0, "/Users/carrickcheah/Project/root_ai/memgc/memgc-py/src")
from memgc import MemGC
```

**Option C — TypeScript bridge** (if FeedMe stays Bun-only):

MemGC is Python. FeedMe's agents could be TypeScript. You need a thin Python service exposing the 5 methods over HTTP:

```python
# memgc-service.py — tiny FastAPI wrapper
from fastapi import FastAPI
from memgc import MemGC

app = FastAPI()
mc_cache: dict[str, MemGC] = {}  # one per restaurant_id

def get_mc(restaurant_id: str) -> MemGC:
    if restaurant_id not in mc_cache:
        mc_cache[restaurant_id] = MemGC.open(f"/data/feedme/{restaurant_id}/memgc.db")
    return mc_cache[restaurant_id]

@app.post("/answer")
async def answer(payload: dict):
    mc = get_mc(payload["restaurant_id"])
    ans = mc.answer(payload["question"])
    return {"text": ans.text, "memories": [...], "tokens": ans.tokens}

@app.post("/extract")
async def extract(payload: dict):
    mc = get_mc(payload["restaurant_id"])
    return {"ids": mc.extract(payload["messages"])}

# similar for consolidate, dreaming
```

Then call from the Bun supervisor:

```typescript
// In src/services/memgc-client.ts
const res = await fetch(`${env.MEMGC_URL}/answer`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ restaurant_id: accountId, question })
});
const { text, memories, tokens } = await res.json();
```

### Per-restaurant vs shared instance

**Per-restaurant.** Each restaurant gets its own SQLite file: `/data/feedme/{restaurantId}/memgc.db`. Reasons:

1. Tenant isolation — Sarah's data must never leak to Restaurant B's agent
2. Backup/restore granularity per restaurant
3. Independent decay schedules (busy restaurants get more memories, may need different threshold tuning)
4. SQLite is fast enough — no contention concern
5. Mirrors ai-agents' filesystem-first pattern

When FeedMe outgrows SQLite per restaurant (a single restaurant generating >500K memories — unlikely but possible for a chain HQ), migrate to per-tenant Postgres schema. Same API.

### 5-line wiring in the Customer-facing Agent

```typescript
// Before composing the system prompt:
const memCtx = await memgc.answer({
  restaurant_id: accountId,
  question: `Customer ${customerId} is at the kiosk. Profile + preferences?`,
});
// memCtx.text → "VIP. Allergic to onions. Last 5 orders: Mushroom Swiss x3..."
// Include memCtx.text in the system prompt as <memory>...</memory>
```

After the order completes:

```typescript
await memgc.extract({
  restaurant_id: accountId,
  messages: turnTranscript,  // list of {speaker, text}
});
```

Nightly cron:

```python
mc = MemGC.open(f"/data/feedme/{rid}/memgc.db")
stats = mc.dreaming()  # archives cold memories
log.info(f"restaurant={rid} archived={stats.archived} kept={stats.kept}")
```

### Cache key strategy for Redis

`mc.answer()` is slow (multi-LLM, 10-13 calls). Cache aggressively.

```
key   = "memgc:{restaurant_id}:answer:{sha256(question)}"
value = JSON.stringify({ text, memories_ids, tokens })
ttl   = 300s  // 5 minutes — long enough for an order, short enough to stay fresh
```

Invalidate keys for `customer_id=X` when `mc.extract([... about X ...])` is called. Easiest: tag-based delete using `redis.del("memgc:{rid}:customer:{cid}:*")` — but that requires structuring keys to embed the customer ID. Or just let TTL handle it.

---

## 🟡 Open Questions / Gaps

1. **No `update()` or `delete()` on individual memories** in the public API. Status flips happen through `extract()` (archive supersedes) and `dreaming()` (archive cold rows). For FeedMe's explicit "forget this customer" GDPR requests, you'll need to either flip status directly in the DB or wait for v0.5 (graph + update/delete roadmap, README line 487).

2. **No multi-tenant scoping built into the schema** (per-row scope). Currently you isolate by giving each tenant its own DB file. v0.5+ ships `user_id/agent_id/run_id` scoping per the roadmap. For FeedMe MVP, per-restaurant file is fine.

3. **PRISM latency** — 10-13 LLM calls × ~1s/call = 10-13s typical, 80s worst case. **Mitigation: Redis cache + analyzer_llm/verifier_llm override to a fast model (Ollama / Haiku).**

4. **No async API yet** (per roadmap, README line 496). All calls block. In the TypeScript bridge, you'd async-wait the HTTP call but the Python side is sync. For high concurrency, run multiple Python service replicas behind a load balancer.

5. **Default embedder is local BGE-M3** which downloads ~few hundred MB on first use and runs on MPS. On Linux servers without MPS, falls back to CPU — slower but still works. For Azure/cloud, prefer `Embedder.from_env()` with text-embedding-3-large.

6. **Default reranker downloads ~2.3GB** (bge-reranker-v2-m3). For server deploys, bake into the Docker image to avoid cold-start downloads.

7. **42 tests is comprehensive for the core surface** but light on PRISM end-to-end scenarios. The bench script `examples/locomo_conv1.py` is the de facto integration test.

8. **No docs (locally) on the Postgres backend yet** — it's in the roadmap but not shipped. If FeedMe hits SQLite scaling concerns, this is the path to upgrade, but plan for it to be in-flight work.

---

## Performance / Cost Notes

From the README (live measurements vs Azure gpt-5.5):

| Metric | MemGC | Naive baseline |
|---|---|---|
| 100-turn agent loop cost | **$0.07** | $7.37 (105× more) |
| `consolidate()` compression | **2.6× – 4×** | n/a |
| Verbatim duplicate rows | **0** (SHA-1) | unbounded |

For FeedMe's economics:
- `mc.answer()` for a customer profile lookup: ~$0.01-0.05 per call. With Redis cache hit rate of 80%+, you're paying for ~20% of unique queries → $0.002-0.01 per customer profile *on average*.
- `mc.extract()` per completed order: ~$0.005 (one extraction LLM call + embed). For 1000 orders/day per restaurant → $5/day → $150/restaurant/month. Negligible vs the LLM cost of the agents themselves.
- `mc.dreaming()` is **pure math, no LLM** — free at scale.

---

## Reusable Test Fixtures

- **`examples/locomo_conv1.py`** — full 81-question LoCoMo benchmark runner. Adapt the harness for FeedMe golden-set scenarios: write `examples/feedme_orders.py` that loads scenarios and runs `mc.answer()` against expected outputs.
- **`tests/`** — 42 pytest tests. Look here for fixtures around `Storage`, fake LLM clients, mock embeddings. **`InMemoryStorage` (per M2 milestone)** is the in-memory test backend — lift it as the test double for FeedMe unit tests.
- **`docs/validation/2026-05-04-cost-and-latency.md`** — read this before benchmarking FeedMe. Methodology is sound; copy the table format for FeedMe's own latency report.

---

## Three-paragraph elevator pitch

**Is this the user's own MemGC build?** Yes — v0.4.0a1 alpha, 42 tests passing, Apache 2.0 in their own repo. Not a fork; not vendored from anyone. The benchmark numbers (LoCoMo 74.1%, 81.6× cost reduction) are theirs. Tests pass, mypy strict, ruff clean. The user is currently iterating on the entity-index (v0.3) and Postgres backend (v0.4) per the roadmap.

**Public API as actually implemented** matches the docs we discussed earlier: `MemGC.open()`, `extract()`, `consolidate()`, `dreaming()`, `answer()` — all five exported from `__init__.py`. The `Answer` return dataclass (text, memories, mode, elapsed_s, tokens) is in `schema.py`. Internal `_recall()` is private. PRISM loop lives in `agent/prism.py` (1183 lines): Analyzer → entity-filter recall → vec+BM25 RRF → cross-encoder rerank → Selector⇔Adder×3 → Generator (N=7 self-consistency) → Verifier. **10-13 LLM calls per `answer()` — Redis cache in front is mandatory.**

**How FeedMe agents will import and use it.** Because MemGC is Python and FeedMe agents are Bun/TypeScript, wrap MemGC in a thin FastAPI service exposing the 5 methods over HTTP. Each FeedMe restaurant gets its own SQLite file at `/data/feedme/{restaurantId}/memgc.db`. Agents call `POST /answer` for profile lookups (cached in Redis with 5-min TTL) and `POST /extract` after each completed order. A nightly cron runs `dreaming()` to decay cold memories. The 5-line per-agent integration: `const memCtx = await memgc.answer({restaurant_id, question}); systemPrompt += memCtx.text;` before each LLM turn, `await memgc.extract({restaurant_id, messages})` after each order. That's the whole memory layer.

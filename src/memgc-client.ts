/**
 * MemGC HTTP client with Redis caching.
 *
 * Talks to the Python memgc-service on port 8003. The agents call this when
 * they need to retrieve customer memory (before-turn hook) or persist new
 * memories (after-turn hook).
 *
 * Redis cache:
 *  - answer() results: keyed by sha256(question), TTL 300s. PRISM is slow
 *    (~30s + ~$0.05/call), so caching is critical. Per-customer profile
 *    fetches are the hot path — same question on repeat sessions hits cache.
 *  - extract() and dreaming() are not cached (they're writes).
 *  - Falls back gracefully if Redis is down (memgc-service still gets hit).
 *  - Falls back gracefully if memgc-service is down (returns empty memory).
 */
import { createHash } from "node:crypto";
import Redis from "ioredis";
import { env } from "./config/env";
import { logger } from "./lib/logger";
import { traced, addSpanAttrs } from "./lib/tracing";

const MEMGC_URL = env.MEMGC_URL;
const ANSWER_CACHE_TTL = 300; // 5 minutes

// ── Redis (lazy, with graceful fallback) ────────────────────
let _redis: Redis | null = null;
let _redisFailed = false;

function getRedis(): Redis | null {
  if (_redisFailed) return null;
  if (_redis) return _redis;
  try {
    _redis = new Redis(env.REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
      enableOfflineQueue: false,
      reconnectOnError: () => false,
    });
    _redis.on("error", (err) => {
      if (!_redisFailed) {
        _redisFailed = true;
        logger.warn({ err: err.message }, "[MEMGC] Redis cache unavailable — proceeding without it");
      }
    });
    return _redis;
  } catch (err) {
    _redisFailed = true;
    logger.warn({ err: String(err) }, "[MEMGC] Redis init failed");
    return null;
  }
}

// ── Types ───────────────────────────────────────────────────
export interface MemoryItem {
  id: number | string;
  speaker: string | null;
  content: string | null;
}

export interface AnswerResult {
  text: string;
  memories: MemoryItem[];
  mode: string;
  elapsed_s: number | null;
  tokens: { input?: number; output?: number };
  /** true if served from Redis cache, false if it was a fresh memgc-service call */
  cached?: boolean;
}

export interface ExtractMessage {
  speaker: string;
  text: string;
}

// ── Utilities ───────────────────────────────────────────────
async function safeFetchJson(url: string, init: RequestInit, timeoutMs: number): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

function answerCacheKey(question: string): string {
  return `memgc:answer:${createHash("sha256").update(question).digest("hex").slice(0, 16)}`;
}

// ── Public API ──────────────────────────────────────────────

export async function memgcOpen(): Promise<{ ready: boolean; db_path?: string }> {
  try {
    const result = (await safeFetchJson(`${MEMGC_URL}/open`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    }, 10_000)) as { ready: boolean; db_path?: string };
    return result;
  } catch (err) {
    logger.warn({ err: String(err) }, "[MEMGC] /open failed — memory layer offline");
    return { ready: false };
  }
}

/**
 * Run the PRISM agentic retrieval loop. Cached in Redis for 5 minutes.
 * Returns empty memory + warning on any failure (memgc-service down, timeout).
 */
export async function memgcAnswer(question: string, opts: { ttl?: number } = {}): Promise<AnswerResult> {
  return traced(
    "feedme.memgc.answer",
    { "feedme.memgc.question_preview": question.slice(0, 80) },
    () => memgcAnswerInner(question, opts),
  );
}

async function memgcAnswerInner(question: string, opts: { ttl?: number }): Promise<AnswerResult> {
  const ttl = opts.ttl ?? ANSWER_CACHE_TTL;
  const key = answerCacheKey(question);

  // 1. Try Redis cache
  const r = getRedis();
  if (r) {
    try {
      const cached = await r.get(key);
      if (cached) {
        logger.debug({ key }, "[MEMGC] cache hit");
        const parsed = JSON.parse(cached) as AnswerResult;
        addSpanAttrs({
          "feedme.memgc.cached": true,
          "feedme.memgc.memory_count": parsed.memories.length,
        });
        return { ...parsed, cached: true };
      }
    } catch (err) {
      logger.debug({ err: String(err) }, "[MEMGC] Redis read failed; bypassing cache");
    }
  }

  // 2. Hit memgc-service
  const t0 = Date.now();
  try {
    const result = (await safeFetchJson(
      `${MEMGC_URL}/answer`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, k_pool: 50, n_iterations: 2, n_samples: 3 }),
      },
      90_000,
    )) as AnswerResult;

    const duration = Date.now() - t0;
    logger.info(
      { question_preview: question.slice(0, 80), duration_ms: duration, memories: result.memories.length },
      "[MEMGC] /answer done",
    );

    // 3. Save to cache (best-effort)
    if (r) {
      r.setex(key, ttl, JSON.stringify(result)).catch((err) =>
        logger.debug({ err: String(err) }, "[MEMGC] Redis write failed"),
      );
    }

    addSpanAttrs({
      "feedme.memgc.cached": false,
      "feedme.memgc.memory_count": result.memories.length,
      "feedme.memgc.mode": result.mode,
      "feedme.memgc.elapsed_s": result.elapsed_s ?? duration / 1000,
    });
    return { ...result, cached: false };
  } catch (err) {
    logger.warn(
      { err: String(err), question_preview: question.slice(0, 80) },
      "[MEMGC] /answer failed — returning empty memory",
    );
    addSpanAttrs({ "feedme.memgc.fallback": true, "feedme.memgc.error": String(err) });
    return {
      text: "",
      memories: [],
      mode: "fallback",
      elapsed_s: (Date.now() - t0) / 1000,
      tokens: {},
      cached: false,
    };
  }
}

/**
 * Persist atomic facts from a transcript. Dedup'd by SHA-1 inside memgc-service.
 * Best-effort — logs but doesn't throw if memgc-service is down.
 */
export async function memgcExtract(messages: ExtractMessage[]): Promise<{ count: number; new_ids: string[] }> {
  if (!messages.length) return { count: 0, new_ids: [] };
  try {
    const result = (await safeFetchJson(
      `${MEMGC_URL}/extract`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages }),
      },
      30_000,
    )) as { count: number; new_ids: string[] };
    logger.info({ count: result.count, new_ids: result.new_ids.length }, "[MEMGC] /extract done");
    return result;
  } catch (err) {
    logger.warn({ err: String(err), msg_count: messages.length }, "[MEMGC] /extract failed");
    return { count: 0, new_ids: [] };
  }
}

export async function memgcDreaming(opts: { dry_run?: boolean } = {}): Promise<{ scanned: number; archived: number; kept: number }> {
  try {
    const result = (await safeFetchJson(
      `${MEMGC_URL}/dreaming`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dry_run: opts.dry_run ?? false }),
      },
      60_000,
    )) as { scanned: number; archived: number; kept: number };
    return result;
  } catch (err) {
    logger.warn({ err: String(err) }, "[MEMGC] /dreaming failed");
    return { scanned: 0, archived: 0, kept: 0 };
  }
}

/**
 * FeedMe — Bun + Hono entry point
 *
 * Phase 1 Day 1: /health, /ready, /api/chat/sync.
 * Phase 1+ adds SSE streaming + webhook routes as needed.
 *
 * Port: 8002
 */

// MUST be first — starts the OpenTelemetry SDK before any HTTP client
// (openai, fetch) is constructed. Otherwise outbound calls are not traced.
import "./instrumentation";

import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger as honoLogger } from "hono/logger";
import { env } from "./config/env";
import { logger as log } from "./lib/logger";
import { chatApp } from "./api/chat";

const app = new Hono();

const corsOrigins = env.CORS_ALLOWED_ORIGINS.split(",").map((o) => o.trim());
app.use(
  "*",
  cors({
    origin: (origin) => {
      if (!origin) return origin ?? "*";
      if (corsOrigins.includes("*")) return origin;
      if (corsOrigins.some((o) => origin.startsWith(o))) return origin;
      return "";
    },
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
  })
);
app.use("*", honoLogger());

// ── health ──────────────────────────────────────────────────
app.get("/health", (c) => c.json({ status: "ok", service: "feedme-app", uptime_s: Math.floor(process.uptime()) }));

app.get("/ready", async (c) => {
  // Phase 0: just confirm we can reach the sidecars. Real readiness checks
  // (Redis ping, Kafka admin, MemGC health) land in Phase 1.
  const checks: Record<string, "ok" | "fail"> = {};
  try {
    const res = await fetch(`${env.MEMGC_URL}/health`, { signal: AbortSignal.timeout(2000) });
    checks.memgc = res.ok ? "ok" : "fail";
  } catch {
    checks.memgc = "fail";
  }
  const allOk = Object.values(checks).every((v) => v === "ok");
  return c.json({ status: allOk ? "ready" : "degraded", checks }, allOk ? 200 : 503);
});

app.get("/", (c) =>
  c.json({
    service: "feedme-app",
    version: "0.0.1",
    phase: "1 (Day 1 — minimal agent)",
    restaurant: env.RESTAURANT_NAME,
    endpoints: ["/health", "/ready", "/api/chat/sync"],
    docs: "see docs/PLAN.md",
  })
);

// ── mount /api/* routes ─────────────────────────────────────
app.route("/api", chatApp);

// ── event system (Kafka consumers + producer) ─────────────────
// Starts in background — boot continues whether Kafka is up or not.
// Falls back to in-process agent triggering when Kafka unreachable.
import { startEventSystem, shutdownEventSystem } from "./events";
startEventSystem()
  .then((status) =>
    log.info(
      { kafka_reachable: status.kafka_reachable, consumers: status.consumers_started, brokers: status.brokers },
      status.kafka_reachable ? "[BOOT] Kafka active" : "[BOOT] in-process fallback (Kafka unreachable)",
    ),
  )
  .catch((err) => log.error({ err: String(err) }, "[BOOT] event system failed to start"));

const shutdown = (sig: string) => {
  log.info({ sig }, "[BOOT] shutting down");
  shutdownEventSystem()
    .catch(() => undefined)
    .then(() => process.exit(0));
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// ── boot ────────────────────────────────────────────────────
log.info({ port: env.PORT, env: env.NODE_ENV, restaurant: env.RESTAURANT_NAME }, "FeedMe app starting");

export default {
  port: env.PORT,
  fetch: app.fetch,
  idleTimeout: 120,
};

export { app };

/**
 * FeedMe — Bun + Hono entry point
 *
 * Phase 1 Day 1: /health, /ready, /api/chat/sync.
 * Phase 1+ adds SSE streaming + webhook routes as needed.
 *
 * Port: 8002
 */

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
    docs: "see PLAN.md in repo root",
  })
);

// ── mount /api/* routes ─────────────────────────────────────
app.route("/api", chatApp);

// ── boot ────────────────────────────────────────────────────
log.info({ port: env.PORT, env: env.NODE_ENV, restaurant: env.RESTAURANT_NAME }, "FeedMe app starting");

export default {
  port: env.PORT,
  fetch: app.fetch,
  idleTimeout: 120,
};

export { app };

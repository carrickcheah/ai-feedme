/**
 * /api/chat — Hono routes for the customer-facing agent.
 *
 * Phase 1 Day 1: only sync POST /chat/sync. SSE streaming lands later.
 */
import { Hono } from "hono";
import { z } from "zod";
import { processChatMessage } from "../agents/customer-facing";
import { logger } from "../lib/logger";

const ChatRequest = z.object({
  message: z.string().min(1).max(2000),
  customer_id: z.string().optional().nullable(),
  session_id: z.string().optional().nullable(),
  channel: z.enum(["kiosk", "mobile", "web"]),
});

const chatApp = new Hono();

chatApp.post("/chat/sync", async (c) => {
  let body;
  try {
    body = ChatRequest.parse(await c.req.json());
  } catch (err) {
    logger.warn({ error: String(err) }, "[API] invalid /api/chat/sync body");
    return c.json({ error: "Invalid request", details: String(err) }, 400);
  }

  const result = await processChatMessage(body);
  return c.json(result, result.success ? 200 : 500);
});

// Placeholder for streaming endpoint — Phase 1+
chatApp.post("/chat", async (c) => {
  return c.json(
    { error: "SSE streaming not yet implemented in Phase 1 Day 1. Use /api/chat/sync." },
    501
  );
});

export { chatApp };

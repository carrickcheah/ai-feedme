/**
 * /api/chat — Hono routes for the customer-facing agent.
 *
 *   POST /chat/sync   — non-streaming, returns full ChatResponse JSON
 *   POST /chat        — Server-Sent Events stream of content deltas + final meta
 */
import { Hono } from "hono";
import { z } from "zod";
import { processChatMessage, processChatMessageStreaming } from "../agents/customer-facing";
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

// SSE streaming endpoint.
// Events:
//   event: chunk  data: {"delta": "Hello "}
//   event: chunk  data: {"delta": "world"}
//   event: done   data: {"output":"...","session_id":"...","tools_called":[...],"tokens":{...},"cost_usd":...}
//   event: error  data: {"message":"..."}
chatApp.post("/chat", async (c) => {
  let body;
  try {
    body = ChatRequest.parse(await c.req.json());
  } catch (err) {
    logger.warn({ error: String(err) }, "[API] invalid /api/chat body");
    return c.json({ error: "Invalid request", details: String(err) }, 400);
  }

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          /* client disconnected */
        }
      };
      try {
        const result = await processChatMessageStreaming(body, (delta) => {
          send("chunk", { delta });
        });
        send(result.success ? "done" : "error", result);
      } catch (err) {
        send("error", { message: err instanceof Error ? err.message : String(err) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
});

export { chatApp };

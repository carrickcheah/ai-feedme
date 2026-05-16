/**
 * POS MCP server — port 4001.
 *
 * Lifted from ai_brain/mcp-servers/chat-now/index.ts pattern (Hono + JSON-RPC).
 * Single-tenant FeedMe simplification: no X-Account-Id validation.
 *
 * Endpoints:
 *  - GET  /              — info
 *  - GET  /health        — liveness
 *  - POST /mcp           — JSON-RPC 2.0 (methods: initialize, tools/list, tools/call)
 *  - POST /tools/:name   — direct tool invocation (for testing)
 */
import { Hono } from "hono";
import { cors } from "hono/cors";
import { toolDefinitions, executeTool } from "./tools";
import { closeDb, getDb } from "./client";

const PORT = parseInt(process.env.MCP_POS_PORT ?? "4001", 10);
const SERVER_NAME = "pos";

// Init DB + schema on boot (lazy via getDb).
getDb();

const app = new Hono();
app.use("*", cors());

// ── info ────────────────────────────────────────────────────
app.get("/", (c) =>
  c.json({
    name: SERVER_NAME,
    description: "POS MCP — menu + orders for IceYoo Desaru",
    version: "1.0.0",
    port: PORT,
    endpoints: { health: "/health", mcp: "/mcp", tools: "/tools/:name" },
    tools: toolDefinitions.map((t) => t.name),
  }),
);

app.get("/health", (c) =>
  c.json({
    status: "healthy",
    server: SERVER_NAME,
    port: PORT,
    tools: toolDefinitions.length,
    timestamp: new Date().toISOString(),
  }),
);

// ── JSON-RPC endpoint ───────────────────────────────────────
app.post("/mcp", async (c) => {
  let requestId: string | number | null = null;
  try {
    const body = (await c.req.json()) as {
      jsonrpc?: string;
      method?: string;
      params?: { name?: string; arguments?: Record<string, unknown> };
      id?: string | number | null;
    };
    requestId = body.id ?? null;
    const { jsonrpc, method, params, id } = body;

    if (jsonrpc !== "2.0") {
      return c.json({
        jsonrpc: "2.0",
        id,
        error: { code: -32600, message: "Invalid Request: jsonrpc must be '2.0'" },
      });
    }

    if (method === "initialize") {
      return c.json({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2024-11-05",
          serverInfo: { name: SERVER_NAME, version: "1.0.0" },
          capabilities: { tools: {} },
        },
      });
    }

    if (method === "tools/list") {
      return c.json({ jsonrpc: "2.0", id, result: { tools: toolDefinitions } });
    }

    if (method === "tools/call") {
      const toolName = params?.name ?? "";
      const toolArgs = params?.arguments ?? {};
      const result = await executeTool(toolName, toolArgs);
      return c.json({ jsonrpc: "2.0", id, result });
    }

    return c.json({
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `Method not found: ${method}` },
    });
  } catch (err) {
    console.error(`[${SERVER_NAME}] /mcp error:`, err);
    return c.json(
      { jsonrpc: "2.0", id: requestId, error: { code: -32700, message: "Parse error" } },
      500,
    );
  }
});

// ── direct tool invocation (test convenience) ───────────────
app.post("/tools/:name", async (c) => {
  const toolName = c.req.param("name");
  const args = (await c.req.json()) as Record<string, unknown>;
  const result = await executeTool(toolName, args);
  return c.json(result, result.isError ? 400 : 200);
});

// ── shutdown ────────────────────────────────────────────────
function setupShutdown(): void {
  const shutdown = (sig: string) => {
    console.log(`[${SERVER_NAME}] ${sig} received — shutting down`);
    closeDb();
    process.exit(0);
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}
setupShutdown();

console.log(`[${SERVER_NAME}] starting on :${PORT} (tools: ${toolDefinitions.length})`);

export default {
  port: PORT,
  fetch: app.fetch,
};

export { app };

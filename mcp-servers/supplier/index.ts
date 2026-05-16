/**
 * Supplier MCP server — port 4004.
 */
import { Hono } from "hono";
import { cors } from "hono/cors";
import { toolDefinitions, executeTool } from "./tools";
import { closeDb, getDb } from "./client";

const PORT = parseInt(process.env.MCP_SUPPLIER_PORT ?? "4014", 10);
const SERVER_NAME = "supplier";

getDb();

const app = new Hono();
app.use("*", cors());

app.get("/", (c) =>
  c.json({
    name: SERVER_NAME, description: "Supplier MCP — ingredients, stock, purchase orders, consumption log",
    version: "1.0.0", port: PORT,
    endpoints: { health: "/health", mcp: "/mcp", tools: "/tools/:name" },
    tools: toolDefinitions.map((t) => t.name),
  }),
);

app.get("/health", (c) =>
  c.json({ status: "healthy", server: SERVER_NAME, port: PORT, tools: toolDefinitions.length, timestamp: new Date().toISOString() }),
);

app.post("/mcp", async (c) => {
  let requestId: string | number | null = null;
  try {
    const body = (await c.req.json()) as { jsonrpc?: string; method?: string; params?: { name?: string; arguments?: Record<string, unknown> }; id?: string | number | null };
    requestId = body.id ?? null;
    const { jsonrpc, method, params, id } = body;
    if (jsonrpc !== "2.0") return c.json({ jsonrpc: "2.0", id, error: { code: -32600, message: "Invalid Request" } });

    if (method === "initialize") {
      return c.json({ jsonrpc: "2.0", id, result: { protocolVersion: "2024-11-05", serverInfo: { name: SERVER_NAME, version: "1.0.0" }, capabilities: { tools: {} } } });
    }
    if (method === "tools/list") return c.json({ jsonrpc: "2.0", id, result: { tools: toolDefinitions } });
    if (method === "tools/call") {
      const result = await executeTool(params?.name ?? "", params?.arguments ?? {});
      return c.json({ jsonrpc: "2.0", id, result });
    }
    return c.json({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } });
  } catch (err) {
    console.error(`[${SERVER_NAME}] /mcp error:`, err);
    return c.json({ jsonrpc: "2.0", id: requestId, error: { code: -32700, message: "Parse error" } }, 500);
  }
});

app.post("/tools/:name", async (c) => {
  const result = await executeTool(c.req.param("name"), (await c.req.json()) as Record<string, unknown>);
  return c.json(result, result.isError ? 400 : 200);
});

function setupShutdown(): void {
  const shutdown = (sig: string) => { console.log(`[${SERVER_NAME}] ${sig} — shutting down`); closeDb(); process.exit(0); };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}
setupShutdown();

console.log(`[${SERVER_NAME}] starting on :${PORT} (tools: ${toolDefinitions.length})`);

export default { port: PORT, fetch: app.fetch };
export { app };

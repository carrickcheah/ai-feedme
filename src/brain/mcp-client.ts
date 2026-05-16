/**
 * MCP HTTP JSON-RPC client.
 *
 * Talks to each FeedMe MCP server (POS, Kitchen Display, Payment, Supplier)
 * over HTTP. Caches the tools list per server URL with a 60s TTL so the agent
 * isn't re-fetching schemas every turn.
 */
import { env } from "../config/env";
import { logger } from "../lib/logger";

export interface McpToolDef {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
}

export interface McpToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

// ── server map ──────────────────────────────────────────────
export const MCP_SERVERS = {
  pos: env.MCP_POS_URL,
  "kitchen-display": env.MCP_KITCHEN_DISPLAY_URL,
  payment: env.MCP_PAYMENT_URL,
  supplier: env.MCP_SUPPLIER_URL,
} as const;
export type McpServerName = keyof typeof MCP_SERVERS;

// ── tools/list cache (60s TTL) ──────────────────────────────
interface CachedTools {
  tools: McpToolDef[];
  fetchedAt: number;
}
const cache = new Map<string, CachedTools>();
const TTL_MS = 60_000;

export async function listTools(server: McpServerName): Promise<McpToolDef[]> {
  const url = MCP_SERVERS[server];
  const cached = cache.get(url);
  if (cached && Date.now() - cached.fetchedAt < TTL_MS) return cached.tools;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) {
    throw new Error(`MCP[${server}] tools/list failed: HTTP ${res.status}`);
  }
  const body = (await res.json()) as {
    result?: { tools?: McpToolDef[] };
    error?: { code: number; message: string };
  };
  if (body.error) {
    throw new Error(`MCP[${server}] tools/list error: ${body.error.message}`);
  }
  const tools = body.result?.tools ?? [];
  cache.set(url, { tools, fetchedAt: Date.now() });
  return tools;
}

export async function callTool(
  server: McpServerName,
  name: string,
  args: Record<string, unknown>,
): Promise<McpToolResult> {
  const url = MCP_SERVERS[server];
  const start = Date.now();
  logger.debug({ server, name, args }, "[MCP] call");

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method: "tools/call",
      params: { name, arguments: args },
    }),
    signal: AbortSignal.timeout(30_000),
  });

  const duration = Date.now() - start;

  if (!res.ok) {
    logger.warn({ server, name, status: res.status, duration_ms: duration }, "[MCP] HTTP error");
    return {
      content: [{ type: "text", text: `MCP HTTP ${res.status}` }],
      isError: true,
    };
  }

  const body = (await res.json()) as {
    result?: McpToolResult;
    error?: { code: number; message: string };
  };

  if (body.error) {
    logger.warn({ server, name, mcpError: body.error, duration_ms: duration }, "[MCP] JSON-RPC error");
    return {
      content: [{ type: "text", text: `MCP error: ${body.error.message}` }],
      isError: true,
    };
  }

  logger.info({ server, name, duration_ms: duration, isError: body.result?.isError ?? false }, "[MCP] done");
  return body.result ?? { content: [], isError: true };
}

/** Health probe — used by /ready and pre-flight checks. */
export async function healthCheck(server: McpServerName): Promise<boolean> {
  const url = MCP_SERVERS[server].replace(/\/mcp$/, "/health");
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

// ── OpenAI tool spec adapter ────────────────────────────────
/**
 * Convert an MCP tool definition to the OpenAI Chat Completions `tools` shape.
 * The LLM sees these — server name prefixed so it knows where to dispatch.
 */
export function toOpenAITools(server: McpServerName, defs: McpToolDef[]): Array<{
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}> {
  return defs.map((d) => ({
    type: "function" as const,
    function: {
      name: `${server}__${d.name}`, // disambiguate when multiple servers share a name
      description: d.description,
      parameters: d.inputSchema,
    },
  }));
}

/** Reverse — pull `(server, toolName)` out of the prefixed function name. */
export function parsePrefixed(prefixed: string): { server: McpServerName; tool: string } | null {
  const idx = prefixed.indexOf("__");
  if (idx < 0) return null;
  const server = prefixed.slice(0, idx) as McpServerName;
  const tool = prefixed.slice(idx + 2);
  if (!(server in MCP_SERVERS)) return null;
  return { server, tool };
}

/**
 * Shared types across all MCP servers (POS, Kitchen Display, Payment, Supplier).
 *
 * Matches the MCP "tools/list" + "tools/call" JSON-RPC contract used by
 * ai_brain/mcp-servers/shared/ — for cross-project compatibility.
 */

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
}

export interface MCPToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

export type ToolHandler = (args: Record<string, unknown>) => Promise<MCPToolResult>;

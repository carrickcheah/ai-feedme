/**
 * Brain module — LLM router.
 *
 * Phase 1 Day 2: Azure OpenAI GPT-5.5, sync chat, MCP tool calling.
 * Phase 1+: streaming via SSE.
 */
export {
  chat,
  chatStream,
  type ChatMessage,
  type ChatResult,
  type ChatOptions,
  type ChatTool,
  type ChatToolCall,
} from "./azure";

export {
  listTools,
  callTool,
  healthCheck,
  toOpenAITools,
  parsePrefixed,
  MCP_SERVERS,
  type McpServerName,
  type McpToolDef,
  type McpToolResult,
} from "./mcp-client";

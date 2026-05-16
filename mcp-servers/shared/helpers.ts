/**
 * Common helpers for shaping MCP tool results.
 */
import type { MCPToolResult } from "./types";

export function formatJsonResult(obj: unknown): MCPToolResult {
  return { content: [{ type: "text", text: JSON.stringify(obj, null, 2) }] };
}

export function formatTextResult(text: string): MCPToolResult {
  return { content: [{ type: "text", text }] };
}

export function formatErrorResult(message: string): MCPToolResult {
  return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
}

export function formatNotFoundResult(what: string): MCPToolResult {
  return { content: [{ type: "text", text: `${what} not found.` }] };
}

export function formatListResult(items: unknown[]): MCPToolResult {
  if (!items.length) return formatTextResult("(no results)");
  return formatJsonResult(items);
}

/** Validation helper: require a string argument. */
export function requireString(args: Record<string, unknown>, key: string): string {
  const val = args[key];
  if (typeof val !== "string" || !val.trim()) {
    throw new Error(`Missing required parameter: ${key}`);
  }
  return val.trim();
}

/** Validation helper: optional string argument. */
export function optionalString(
  args: Record<string, unknown>,
  key: string,
): string | undefined {
  const val = args[key];
  if (val == null) return undefined;
  if (typeof val !== "string") {
    throw new Error(`Parameter ${key} must be a string`);
  }
  const trimmed = val.trim();
  return trimmed || undefined;
}

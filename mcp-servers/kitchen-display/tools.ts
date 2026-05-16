/**
 * Kitchen Display MCP — 4 tool definitions + dispatcher.
 */
import type { ToolDefinition, MCPToolResult, ToolHandler } from "../shared/types";
import { formatJsonResult, formatErrorResult, formatNotFoundResult, requireString, optionalString } from "../shared/helpers";
import * as kds from "./client";

export const toolDefinitions: ToolDefinition[] = [
  {
    name: "send_ticket",
    description:
      "Push a ticket to the Kitchen Display System for an order. Splits items by station " +
      "(grill / fry / cold / bev) and computes fire_at times so multi-station items plate together. " +
      "Call this once per order after pos.create_order succeeds.",
    inputSchema: {
      type: "object",
      properties: {
        order_id: { type: "string" },
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              sku: { type: "string" },
              qty: { type: "number" },
              modifiers: { type: "object", additionalProperties: true },
            },
            required: ["sku", "qty"],
          },
        },
        priority: { type: "number", description: "0-10. Default 0. VIP customers get 5+." },
      },
      required: ["order_id", "items"],
    },
  },
  {
    name: "mark_ready",
    description: "Flip a ticket to 'plated' (food is ready for pickup). Decrements the station's queue depth.",
    inputSchema: {
      type: "object",
      properties: { ticket_id: { type: "string" } },
      required: ["ticket_id"],
    },
  },
  {
    name: "expedite",
    description: "Bump a ticket's priority. Higher priority moves it ahead in the station queue.",
    inputSchema: {
      type: "object",
      properties: {
        ticket_id: { type: "string" },
        priority_boost: { type: "number", description: "Default 10." },
      },
      required: ["ticket_id"],
    },
  },
  {
    name: "get_queue",
    description: "Inspect the current kitchen queue. Filter by station if needed. Used for wait-time estimates.",
    inputSchema: {
      type: "object",
      properties: {
        station: { type: "string", enum: ["grill", "fry", "cold", "bev"] },
      },
    },
  },
];

const handlers: Record<string, ToolHandler> = {
  send_ticket: async (args) => {
    const order_id = requireString(args, "order_id");
    const priority = typeof args.priority === "number" ? args.priority : 0;
    if (!Array.isArray(args.items) || !args.items.length) return formatErrorResult("`items` must be a non-empty array.");
    try {
      const tickets = kds.sendTicketsForOrder({ order_id, priority, items: args.items as Array<{ sku: string; qty: number; modifiers?: Record<string, unknown> }> });
      return formatJsonResult({
        order_id,
        tickets,
        message: `Sent ${tickets.length} ticket${tickets.length === 1 ? "" : "s"} across stations: ${tickets.map((t) => t.station).join(", ")}.`,
      });
    } catch (err) {
      return formatErrorResult(err instanceof Error ? err.message : String(err));
    }
  },

  mark_ready: async (args) => {
    const ticket_id = requireString(args, "ticket_id");
    const r = kds.markReady(ticket_id);
    if (!r.ok) return formatNotFoundResult(`Ticket ${ticket_id}`);
    return formatJsonResult({ ok: true, ticket_id, ready_at: r.ready_at });
  },

  expedite: async (args) => {
    const ticket_id = requireString(args, "ticket_id");
    const boost = typeof args.priority_boost === "number" ? args.priority_boost : 10;
    const r = kds.expedite(ticket_id, boost);
    if (!r) return formatNotFoundResult(`Ticket ${ticket_id}`);
    return formatJsonResult({ ticket_id, new_priority: r.new_priority });
  },

  get_queue: async (args) => {
    const station = optionalString(args, "station");
    return formatJsonResult(kds.getQueue({ station }));
  },
};

export async function executeTool(toolName: string, args: Record<string, unknown>): Promise<MCPToolResult> {
  const handler = handlers[toolName];
  if (!handler) return formatErrorResult(`Unknown tool: ${toolName}`);
  try {
    return await handler(args);
  } catch (err) {
    return formatErrorResult(err instanceof Error ? err.message : String(err));
  }
}

/**
 * POS MCP — 4 tool definitions + dispatcher.
 *
 * Tools: search_menu, get_order, create_order, update_order_status
 * See SCHEMAS.md §4.1 for the contract.
 */
import { ulid } from "ulid";
import type { ToolDefinition, MCPToolResult, ToolHandler } from "../shared/types";
import {
  formatJsonResult,
  formatErrorResult,
  formatNotFoundResult,
  requireString,
  optionalString,
} from "../shared/helpers";
import * as pos from "./client";

// ─────────────────────────────────────────────────────────────
// Tool definitions (advertised to the LLM via tools/list)
// ─────────────────────────────────────────────────────────────

export const toolDefinitions: ToolDefinition[] = [
  {
    name: "search_menu",
    description:
      "Search the IceYoo Desaru menu by natural-language query. " +
      "Use this whenever the customer asks about items, before suggesting alternatives, " +
      "or before calling create_order to validate SKUs. " +
      "Returns at most `limit` items (default 10). " +
      "Set only_available=false to include 86'd items (rare; only for menu staff queries).",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Free-text search (e.g. 'mango', 'spicy chicken', 'oreo bingsu'). Omit to list everything." },
        category: {
          type: "string",
          enum: ["YOOYOO SAVER", "BINGSU", "YOOYOO BOWL", "WOORI ICE BLENDED", "YOOYOO EAT"],
          description: "Optional category filter.",
        },
        only_available: { type: "boolean", description: "Filter to available items only. Default true." },
        limit: { type: "number", description: "Max items to return (1-100, default 10)." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_order",
    description: "Look up an existing order by its order_id (e.g. 'ord_01H...'). Returns order details + line items.",
    inputSchema: {
      type: "object",
      properties: {
        order_id: { type: "string", description: "Order ID returned by create_order." },
      },
      required: ["order_id"],
      additionalProperties: false,
    },
  },
  {
    name: "create_order",
    description:
      "Place an order. Validates every SKU exists and is available; rejects with a clear error if not. " +
      "Returns the new order_id + computed totals. " +
      "Always confirm the order with the customer (read back items + total) BEFORE calling this.",
    inputSchema: {
      type: "object",
      properties: {
        customer_id: { type: ["string", "null"], description: "Customer ID if known, else null for anonymous order." },
        session_id: { type: ["string", "null"], description: "Agent session id (for traceability). Optional." },
        channel: {
          type: "string",
          enum: ["kiosk", "mobile", "web"],
          description: "Which channel the customer is ordering from.",
        },
        items: {
          type: "array",
          description: "Line items.",
          items: {
            type: "object",
            properties: {
              sku: { type: "string", description: "Menu item SKU (from search_menu)." },
              qty: { type: "number", description: "Quantity (>= 1)." },
              modifiers: {
                type: "object",
                description: "Optional modifiers, e.g. {\"no_ice\": true, \"extra_topping\": true}.",
                additionalProperties: true,
              },
              notes: { type: "string", description: "Optional per-line notes." },
            },
            required: ["sku", "qty"],
          },
        },
        notes: { type: "string", description: "Optional order-level notes (e.g. 'birthday party')." },
      },
      required: ["channel", "items"],
      additionalProperties: false,
    },
  },
  {
    name: "update_order_status",
    description:
      "Move an order through its status lifecycle. " +
      "Valid transitions: pending → confirmed → preparing → ready → delivered. " +
      "Also: cancelled (from any non-delivered state). " +
      "The customer-facing agent should NOT call this directly — kitchen + payment manage it.",
    inputSchema: {
      type: "object",
      properties: {
        order_id: { type: "string" },
        status: {
          type: "string",
          enum: ["pending", "confirmed", "preparing", "ready", "delivered", "cancelled"],
        },
      },
      required: ["order_id", "status"],
      additionalProperties: false,
    },
  },
];

// ─────────────────────────────────────────────────────────────
// Handlers
// ─────────────────────────────────────────────────────────────

const handlers: Record<string, ToolHandler> = {
  search_menu: async (args) => {
    const query = optionalString(args, "query");
    const category = optionalString(args, "category");
    const only_available = args.only_available !== false;
    const limit = typeof args.limit === "number" ? Math.max(1, Math.min(100, args.limit)) : 10;
    const items = pos.searchMenu({ query, category, only_available, limit });
    if (!items.length) {
      return {
        content: [
          {
            type: "text",
            text: query
              ? `No items match "${query}". Try a different keyword (e.g. mango, chicken, bingsu).`
              : "Menu is empty — has it been seeded? Run `bun run scripts/seed-pos.ts`.",
          },
        ],
      };
    }
    // Compact projection for LLM — drop verbose fields
    return formatJsonResult(
      items.map((it) => ({
        sku: it.sku,
        code: it.code,
        name: it.name,
        price_cents: it.price_cents,
        price_display: `RM${(it.price_cents / 100).toFixed(2)}`,
        category: it.category,
        allergens: it.allergens,
        prep_time_seconds: it.prep_time_seconds,
        is_available: it.is_available,
      })),
    );
  },

  get_order: async (args) => {
    const order_id = requireString(args, "order_id");
    const result = pos.getOrderById(order_id);
    if (!result) return formatNotFoundResult(`Order ${order_id}`);
    return formatJsonResult({
      order: {
        ...result.order,
        total_display: `RM${(result.order.total_cents / 100).toFixed(2)}`,
      },
      lines: result.lines.map((l) => ({
        ...l,
        unit_price_display: `RM${(l.unit_price_cents / 100).toFixed(2)}`,
        line_total_display: `RM${(l.line_total_cents / 100).toFixed(2)}`,
      })),
    });
  },

  create_order: async (args) => {
    const channel = requireString(args, "channel");
    if (!["kiosk", "mobile", "web"].includes(channel)) {
      return formatErrorResult(`Invalid channel: ${channel}`);
    }
    const customer_id = optionalString(args, "customer_id") ?? null;
    const session_id = optionalString(args, "session_id") ?? null;
    const notes = optionalString(args, "notes");
    const itemsArg = args.items;
    if (!Array.isArray(itemsArg) || !itemsArg.length) {
      return formatErrorResult("`items` must be a non-empty array.");
    }
    const items = itemsArg.map((it, idx) => {
      const item = it as Record<string, unknown>;
      const sku = typeof item.sku === "string" ? item.sku.trim() : "";
      const qty = typeof item.qty === "number" ? item.qty : Number(item.qty);
      if (!sku) throw new Error(`items[${idx}].sku is required`);
      if (!Number.isInteger(qty) || qty < 1) {
        throw new Error(`items[${idx}].qty must be a positive integer (got ${item.qty})`);
      }
      return {
        sku,
        qty,
        modifiers: (item.modifiers as Record<string, unknown> | undefined) ?? {},
        notes: typeof item.notes === "string" ? item.notes : undefined,
      };
    });

    try {
      const result = pos.createOrder({
        order_id: `ord_${ulid()}`,
        customer_id,
        session_id,
        channel,
        items,
        notes,
      });
      return formatJsonResult({
        ...result,
        total_display: `RM${(result.total_cents / 100).toFixed(2)}`,
        message: `Order placed: ${result.order_id} (${items.length} line${items.length === 1 ? "" : "s"}, RM${(result.total_cents / 100).toFixed(2)} total).`,
      });
    } catch (err) {
      return formatErrorResult(err instanceof Error ? err.message : String(err));
    }
  },

  update_order_status: async (args) => {
    const order_id = requireString(args, "order_id");
    const status = requireString(args, "status");
    try {
      const ok = pos.updateOrderStatus(order_id, status);
      if (!ok) return formatNotFoundResult(`Order ${order_id}`);
      return formatJsonResult({ ok: true, order_id, status });
    } catch (err) {
      return formatErrorResult(err instanceof Error ? err.message : String(err));
    }
  },
};

// ─────────────────────────────────────────────────────────────
// Public dispatch
// ─────────────────────────────────────────────────────────────

export async function executeTool(
  toolName: string,
  args: Record<string, unknown>,
): Promise<MCPToolResult> {
  const handler = handlers[toolName];
  if (!handler) return formatErrorResult(`Unknown tool: ${toolName}`);
  try {
    return await handler(args);
  } catch (err) {
    return formatErrorResult(err instanceof Error ? err.message : String(err));
  }
}

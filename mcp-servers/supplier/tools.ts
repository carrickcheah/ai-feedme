/**
 * Supplier MCP — 5 tool definitions + dispatcher.
 */
import { ulid } from "ulid";
import type { ToolDefinition, MCPToolResult, ToolHandler } from "../shared/types";
import { formatJsonResult, formatErrorResult, requireString, optionalString } from "../shared/helpers";
import * as sup from "./client";

export const toolDefinitions: ToolDefinition[] = [
  {
    name: "list_suppliers",
    description: "List active suppliers, or the preferred supplier for a specific ingredient.",
    inputSchema: {
      type: "object",
      properties: { ingredient_id: { type: "string" } },
    },
  },
  {
    name: "get_ingredient_stock",
    description: "Inspect ingredient stock levels. Use this before placing a supplier order or to see what's low.",
    inputSchema: {
      type: "object",
      properties: { ingredient_id: { type: "string", description: "Omit to list all ingredients." } },
    },
  },
  {
    name: "place_order",
    description:
      "Place a purchase order with a supplier for one or more ingredients. " +
      "Returns the supplier_order_id and expected_at timestamp.",
    inputSchema: {
      type: "object",
      properties: {
        supplier_id: { type: "string" },
        lines: {
          type: "array",
          items: {
            type: "object",
            properties: {
              ingredient_id: { type: "string" },
              qty: { type: "number" },
            },
            required: ["ingredient_id", "qty"],
          },
        },
      },
      required: ["supplier_id", "lines"],
    },
  },
  {
    name: "get_lead_time",
    description: "Look up the delivery lead time for a supplier or for an ingredient's preferred supplier (in hours).",
    inputSchema: {
      type: "object",
      properties: {
        supplier_id: { type: "string" },
        ingredient_id: { type: "string" },
      },
    },
  },
  {
    name: "record_ingredient_consumption",
    description:
      "Decrement stock for the ingredients used to cook a list of SKUs. " +
      "Translates each sku → ingredient list (via pos.db.menu_item.ingredient_ids), decrements, returns which ingredients dropped below par. " +
      "Kitchen Agent calls this after sending a ticket to KDS.",
    inputSchema: {
      type: "object",
      properties: {
        order_id: { type: "string" },
        ticket_id: { type: "string" },
        sku_consumption: {
          type: "array",
          items: {
            type: "object",
            properties: {
              sku: { type: "string" },
              qty: { type: "number" },
            },
            required: ["sku", "qty"],
          },
        },
      },
      required: ["order_id", "sku_consumption"],
    },
  },
];

const handlers: Record<string, ToolHandler> = {
  list_suppliers: async (args) => {
    const ingredient_id = optionalString(args, "ingredient_id");
    const suppliers = sup.listSuppliers({ ingredient_id });
    return formatJsonResult(suppliers);
  },

  get_ingredient_stock: async (args) => {
    const ingredient_id = optionalString(args, "ingredient_id");
    return formatJsonResult(sup.getIngredientStock(ingredient_id));
  },

  place_order: async (args) => {
    const supplier_id = requireString(args, "supplier_id");
    if (!Array.isArray(args.lines) || !args.lines.length) return formatErrorResult("`lines` must be a non-empty array.");
    const lines = (args.lines as Array<Record<string, unknown>>).map((l, i) => {
      const ingredient_id = typeof l.ingredient_id === "string" ? l.ingredient_id : "";
      const qty = typeof l.qty === "number" ? l.qty : Number(l.qty);
      if (!ingredient_id) throw new Error(`lines[${i}].ingredient_id required`);
      if (!Number.isFinite(qty) || qty <= 0) throw new Error(`lines[${i}].qty must be > 0`);
      return { ingredient_id, qty };
    });
    try {
      const r = sup.placeSupplierOrder({ supplier_order_id: `sop_${ulid()}`, supplier_id, lines });
      return formatJsonResult({
        ...r,
        total_display: `RM${(r.total_cents / 100).toFixed(2)}`,
        message: `Purchase order ${r.supplier_order_id} placed with ${supplier_id}. Expected by ${r.expected_at}.`,
      });
    } catch (err) {
      return formatErrorResult(err instanceof Error ? err.message : String(err));
    }
  },

  get_lead_time: async (args) => {
    const supplier_id = optionalString(args, "supplier_id");
    const ingredient_id = optionalString(args, "ingredient_id");
    return formatJsonResult(sup.getLeadTime({ supplier_id, ingredient_id }));
  },

  record_ingredient_consumption: async (args) => {
    const order_id = requireString(args, "order_id");
    const ticket_id = optionalString(args, "ticket_id");
    if (!Array.isArray(args.sku_consumption) || !args.sku_consumption.length) {
      return formatErrorResult("`sku_consumption` must be a non-empty array.");
    }
    const sku_consumption = (args.sku_consumption as Array<Record<string, unknown>>).map((l, i) => {
      const sku = typeof l.sku === "string" ? l.sku : "";
      const qty = typeof l.qty === "number" ? l.qty : Number(l.qty);
      if (!sku) throw new Error(`sku_consumption[${i}].sku required`);
      if (!Number.isFinite(qty) || qty <= 0) throw new Error(`sku_consumption[${i}].qty must be > 0`);
      return { sku, qty };
    });
    try {
      const r = sup.recordConsumption({ order_id, ticket_id, sku_consumption });
      return formatJsonResult({
        ...r,
        message:
          r.low_stock_ingredients.length > 0
            ? `Consumed. WARNING: ${r.low_stock_ingredients.length} ingredient(s) now below par: ${r.low_stock_ingredients.join(", ")}.`
            : "Consumed. All stock levels above par.",
      });
    } catch (err) {
      return formatErrorResult(err instanceof Error ? err.message : String(err));
    }
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

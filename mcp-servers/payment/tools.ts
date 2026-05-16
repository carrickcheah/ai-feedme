/**
 * Payment MCP — 4 tool definitions + dispatcher.
 * Phase 1 prototype: process_payment auto-captures (stub). refund is LOCKED (Phase 4 HITL).
 */
import { ulid } from "ulid";
import type { ToolDefinition, MCPToolResult, ToolHandler } from "../shared/types";
import { formatJsonResult, formatErrorResult, formatNotFoundResult, requireString, optionalString } from "../shared/helpers";
import * as pay from "./client";

export const toolDefinitions: ToolDefinition[] = [
  {
    name: "process_payment",
    description:
      "Capture payment for an order. Prototype: every method auto-captures immediately (no real processor wired). " +
      "Call after pos.create_order returns when the customer is ready to pay.",
    inputSchema: {
      type: "object",
      properties: {
        order_id: { type: "string" },
        amount_cents: { type: "number" },
        method: { type: "string", enum: ["card", "ewallet", "cash", "apple_pay", "stub"] },
        metadata: { type: "object", additionalProperties: true },
      },
      required: ["order_id", "amount_cents", "method"],
    },
  },
  {
    name: "void_payment",
    description: "Void an unCaptured payment intent. Returns ok=false if already captured.",
    inputSchema: {
      type: "object",
      properties: { intent_id: { type: "string" } },
      required: ["intent_id"],
    },
  },
  {
    name: "refund",
    description:
      "Issue a refund. THIS TOOL IS LOCKED — requires manager approval via HITL flow (Phase 4). " +
      "Always returns an error in Phase 1 prototype; do not call.",
    inputSchema: {
      type: "object",
      properties: {
        intent_id: { type: "string" },
        amount_cents: { type: "number" },
        reason: { type: "string" },
      },
      required: ["intent_id", "amount_cents", "reason"],
    },
  },
  {
    name: "get_payment",
    description: "Look up payment status by intent_id or order_id.",
    inputSchema: {
      type: "object",
      properties: {
        intent_id: { type: "string" },
        order_id: { type: "string" },
      },
    },
  },
];

const handlers: Record<string, ToolHandler> = {
  process_payment: async (args) => {
    const order_id = requireString(args, "order_id");
    const method = requireString(args, "method");
    const amount_cents = typeof args.amount_cents === "number" ? args.amount_cents : Number(args.amount_cents);
    if (!Number.isInteger(amount_cents) || amount_cents < 1) {
      return formatErrorResult(`amount_cents must be a positive integer (got ${args.amount_cents})`);
    }
    const intent_id = `pi_${ulid()}`;
    try {
      const intent = pay.processPayment({
        intent_id, order_id, amount_cents, method,
        metadata: (args.metadata as Record<string, unknown>) ?? {},
      });
      return formatJsonResult({
        ...intent,
        amount_display: `RM${(intent.amount_cents / 100).toFixed(2)}`,
        message: `Payment captured: ${intent.intent_id} (RM${(intent.amount_cents / 100).toFixed(2)})`,
      });
    } catch (err) {
      return formatErrorResult(err instanceof Error ? err.message : String(err));
    }
  },

  void_payment: async (args) => {
    const intent_id = requireString(args, "intent_id");
    const ok = pay.voidPayment(intent_id);
    return formatJsonResult({ ok, intent_id });
  },

  refund: async () => {
    return formatErrorResult(
      "LOCKED — refunds require manager approval (Phase 4 HITL flow not yet wired). Escalate to staff.",
    );
  },

  get_payment: async (args) => {
    const intent_id = optionalString(args, "intent_id");
    const order_id = optionalString(args, "order_id");
    if (!intent_id && !order_id) return formatErrorResult("Provide intent_id or order_id.");
    const intent = pay.getPayment({ intent_id, order_id });
    if (!intent) return formatNotFoundResult(`Payment ${intent_id ?? order_id}`);
    return formatJsonResult({
      ...intent,
      amount_display: `RM${(intent.amount_cents / 100).toFixed(2)}`,
    });
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

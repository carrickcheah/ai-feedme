/**
 * Kafka event envelopes — see SCHEMAS.md §2.
 */

export interface EventEnvelope<T> {
  event_id: string;
  event_type: string;
  timestamp: string; // ISO-8601
  trace_id?: string;
  data: T;
}

export interface OrderCreatedData {
  order_id: string;
  customer_id: string | null;
  session_id: string | null;
  channel: "kiosk" | "mobile" | "web";
  items: Array<{
    sku: string;
    qty: number;
    modifiers?: Record<string, unknown>;
    notes?: string;
  }>;
  subtotal_cents?: number;
  total_cents?: number;
}

export interface IngredientConsumedData {
  order_id: string;
  ticket_id: string | null;
  ingredient_id: string;
  qty: number;
  remaining_stock: number;
}

export interface StockLowData {
  ingredient_id: string;
  ingredient_name: string;
  current_stock: number;
  par_qty: number;
  affected_skus: string[];
  reorder_triggered: boolean;
  supplier_order_id?: string;
}

export interface TicketReadyData {
  ticket_id: string;
  order_id: string;
  station: string;
  ready_at: string;
}

/**
 * Kafka publisher with graceful in-process fallback.
 *
 * When Kafka is reachable (KAFKA_BROKERS in .env and broker up), events go through
 * Kafka — consumers in another process (or this same process) wake the relevant agent.
 *
 * When Kafka is NOT reachable, we fall back to invoking the in-process handler
 * directly. This lets the demo work whether or not `make up` has been run.
 */
import { ulid } from "ulid";
import { Kafka, type Producer } from "kafkajs";
import { env } from "../config/env";
import { logger } from "../lib/logger";
import { handleOrderCreated as kitchenHandleOrderCreated } from "../agents/kitchen";
import { handleIngredientConsumed as inventoryHandleIngredientConsumed } from "../agents/inventory";
import { handleStockLow as propagatorHandleStockLow } from "./86-propagator";
import type {
  EventEnvelope,
  OrderCreatedData,
  IngredientConsumedData,
  StockLowData,
  TicketReadyData,
} from "./types";

let kafkaClient: Kafka | null = null;
let producer: Producer | null = null;
let producerState: "idle" | "connecting" | "connected" | "failed" = "idle";
let lastFailedAt = 0;
const FAILED_COOLDOWN_MS = 30_000;

function getKafka(): Kafka {
  if (!kafkaClient) {
    kafkaClient = new Kafka({
      clientId: "feedme",
      brokers: env.KAFKA_BROKERS.split(",").map((s) => s.trim()),
      retry: { retries: 0, initialRetryTime: 200 },
      logCreator: () => () => {}, // silence kafkajs internal logs
    });
  }
  return kafkaClient;
}

async function tryGetProducer(): Promise<Producer | null> {
  if (producerState === "connected" && producer) return producer;
  if (producerState === "connecting") return null;
  // Cooldown after a failure — retry every 30s instead of latching forever.
  if (producerState === "failed" && Date.now() - lastFailedAt < FAILED_COOLDOWN_MS) {
    return null;
  }
  producerState = "connecting";
  try {
    const p = getKafka().producer({ allowAutoTopicCreation: true });
    await Promise.race([
      p.connect(),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("Kafka connect timeout")), 3000)),
    ]);
    producer = p;
    producerState = "connected";
    logger.info("[KAFKA] producer connected");
    return p;
  } catch (err) {
    producerState = "failed";
    lastFailedAt = Date.now();
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), brokers: env.KAFKA_BROKERS, cooldown_ms: FAILED_COOLDOWN_MS },
      "[KAFKA] producer connect failed — falling back to in-process; will retry after cooldown",
    );
    return null;
  }
}

function envelope<T>(eventType: string, data: T, traceId?: string): EventEnvelope<T> {
  return {
    event_id: ulid(),
    event_type: eventType,
    timestamp: new Date().toISOString(),
    trace_id: traceId,
    data,
  };
}

interface PublishResult {
  /** true if delivered to Kafka; false if fell back to in-process */
  via_kafka: boolean;
  event_id: string;
  /** true if delivery (Kafka send OR fallback handler) completed successfully */
  ok: boolean;
  /** Error message if the fallback handler threw. Empty on success. */
  error?: string;
}

/**
 * Publish to Kafka if available, else invoke the in-process fallback.
 * `fallback` is called only when Kafka delivery fails — so the agent always wakes,
 * either via Kafka consumer or direct function call.
 */
async function publishOrFallback<T>(
  topic: string,
  data: T,
  fallback: ((data: T) => Promise<void>) | null,
  traceId?: string,
): Promise<PublishResult> {
  const e = envelope(topic, data, traceId);
  const p = await tryGetProducer();
  if (p) {
    try {
      await p.send({ topic, messages: [{ value: JSON.stringify(e) }] });
      logger.info({ topic, event_id: e.event_id }, "[KAFKA] published");
      return { via_kafka: true, event_id: e.event_id, ok: true };
    } catch (err) {
      logger.warn(
        { topic, err: err instanceof Error ? err.message : String(err) },
        "[KAFKA] publish failed — falling back to in-process",
      );
    }
  }
  // Fallback: invoke in-process handler. Await so failures surface to caller.
  if (fallback) {
    try {
      await fallback(data);
      return { via_kafka: false, event_id: e.event_id, ok: true };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logger.error({ topic, err: error }, "[FALLBACK] in-process handler failed");
      return { via_kafka: false, event_id: e.event_id, ok: false, error };
    }
  }
  return { via_kafka: false, event_id: e.event_id, ok: true };
}

// ── typed publishers ────────────────────────────────────────

export async function publishOrderCreated(
  data: OrderCreatedData,
  traceId?: string,
): Promise<PublishResult> {
  return publishOrFallback(
    env.KAFKA_TOPIC_ORDER_CREATED,
    data,
    async (d) => {
      logger.info({ order_id: d.order_id }, "[FALLBACK] invoking kitchen handler in-process");
      await kitchenHandleOrderCreated(d);
    },
    traceId,
  );
}

export async function publishIngredientConsumed(
  data: IngredientConsumedData,
  traceId?: string,
): Promise<PublishResult> {
  return publishOrFallback(
    env.KAFKA_TOPIC_INGREDIENT_CONSUMED,
    data,
    async (d) => {
      logger.info({ ingredient_id: d.ingredient_id }, "[FALLBACK] invoking inventory handler in-process");
      await inventoryHandleIngredientConsumed(d);
    },
    traceId,
  );
}

export async function publishStockLow(
  data: StockLowData,
  traceId?: string,
): Promise<PublishResult> {
  return publishOrFallback(
    env.KAFKA_TOPIC_STOCK_LOW,
    data,
    async (d) => {
      logger.info({ ingredient_id: d.ingredient_id, affected: d.affected_skus.length }, "[FALLBACK] invoking 86-propagator in-process");
      await propagatorHandleStockLow(d);
    },
    traceId,
  );
}

export async function publishTicketReady(
  data: TicketReadyData,
  traceId?: string,
): Promise<PublishResult> {
  return publishOrFallback(env.KAFKA_TOPIC_TICKET_READY, data, null, traceId);
}

export async function shutdownProducer(): Promise<void> {
  if (producer) {
    try {
      await producer.disconnect();
    } catch (err) {
      logger.warn({ err: String(err) }, "[KAFKA] producer shutdown error (ignored)");
    }
    producer = null;
    producerState = "idle";
  }
}

export function kafkaStatus(): { state: string; brokers: string } {
  return { state: producerState, brokers: env.KAFKA_BROKERS };
}

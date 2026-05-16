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
  if (producerState === "failed") return null;
  if (producerState === "connecting") return null;
  producerState = "connecting";
  try {
    const p = getKafka().producer({ allowAutoTopicCreation: true });
    // Race against a 3s timeout — if Kafka isn't up, kafkajs hangs by default
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
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), brokers: env.KAFKA_BROKERS },
      "[KAFKA] producer connect failed — events will fall back to in-process",
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
      return { via_kafka: true, event_id: e.event_id };
    } catch (err) {
      logger.warn(
        { topic, err: err instanceof Error ? err.message : String(err) },
        "[KAFKA] publish failed — falling back to in-process",
      );
    }
  }
  // Fallback: invoke in-process handler. Fire-and-forget; errors logged not thrown.
  if (fallback) {
    Promise.resolve()
      .then(() => fallback(data))
      .catch((err) =>
        logger.error({ topic, err: String(err) }, "[FALLBACK] in-process handler failed"),
      );
    return { via_kafka: false, event_id: e.event_id };
  }
  return { via_kafka: false, event_id: e.event_id };
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
  return publishOrFallback(env.KAFKA_TOPIC_INGREDIENT_CONSUMED, data, null, traceId);
}

export async function publishStockLow(
  data: StockLowData,
  traceId?: string,
): Promise<PublishResult> {
  return publishOrFallback(env.KAFKA_TOPIC_STOCK_LOW, data, null, traceId);
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

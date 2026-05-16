/**
 * Kafka consumers — wake the right agent on each event type.
 *
 * Same graceful pattern as publisher: if Kafka is unreachable, the consumer
 * fails to start, we log + skip. The in-process fallback in publisher.ts ensures
 * agents still get triggered.
 */
import { Kafka, type Consumer } from "kafkajs";
import { env } from "../config/env";
import { logger } from "../lib/logger";
import { handleOrderCreated as kitchenHandleOrderCreated } from "../agents/kitchen";
import type { EventEnvelope, OrderCreatedData } from "./types";

let kafkaClient: Kafka | null = null;
const consumers: Consumer[] = [];

function getKafka(): Kafka {
  if (!kafkaClient) {
    kafkaClient = new Kafka({
      clientId: "feedme",
      brokers: env.KAFKA_BROKERS.split(",").map((s) => s.trim()),
      retry: { retries: 0, initialRetryTime: 200 },
      logCreator: () => () => {},
    });
  }
  return kafkaClient;
}

async function startConsumerWithTimeout(consumer: Consumer, topic: string, timeoutMs = 3000): Promise<boolean> {
  try {
    await Promise.race([
      (async () => {
        await consumer.connect();
        await consumer.subscribe({ topic, fromBeginning: false });
      })(),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("Kafka subscribe timeout")), timeoutMs)),
    ]);
    return true;
  } catch (err) {
    logger.warn(
      { topic, err: err instanceof Error ? err.message : String(err) },
      "[KAFKA] consumer subscribe failed — skipping (in-process fallback still active)",
    );
    try {
      await consumer.disconnect();
    } catch {
      // ignore
    }
    return false;
  }
}

/** Subscribe Kitchen Agent to order.created events. */
export async function startKitchenConsumer(): Promise<boolean> {
  const consumer = getKafka().consumer({ groupId: "kitchen-agent" });
  if (!(await startConsumerWithTimeout(consumer, env.KAFKA_TOPIC_ORDER_CREATED))) return false;

  consumer
    .run({
      eachMessage: async ({ message }) => {
        try {
          if (!message.value) return;
          const env = JSON.parse(message.value.toString()) as EventEnvelope<OrderCreatedData>;
          logger.info(
            { event_id: env.event_id, order_id: env.data.order_id },
            "[KAFKA:kitchen-consumer] message received",
          );
          await kitchenHandleOrderCreated(env.data);
        } catch (err) {
          logger.error(
            { err: err instanceof Error ? err.message : String(err) },
            "[KAFKA:kitchen-consumer] handler error",
          );
        }
      },
    })
    .catch((err) => logger.error({ err: String(err) }, "[KAFKA:kitchen-consumer] run() error"));

  consumers.push(consumer);
  logger.info({ topic: env.KAFKA_TOPIC_ORDER_CREATED }, "[KAFKA] kitchen consumer running");
  return true;
}

export async function shutdownConsumers(): Promise<void> {
  for (const c of consumers) {
    try {
      await c.disconnect();
    } catch (err) {
      logger.warn({ err: String(err) }, "[KAFKA] consumer shutdown error (ignored)");
    }
  }
  consumers.length = 0;
}

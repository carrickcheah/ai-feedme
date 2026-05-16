/**
 * Event system — Kafka producer + consumers with in-process fallback.
 */
import { startKitchenConsumer, startInventoryConsumer, startStockLowConsumer, shutdownConsumers } from "./consumers";
import { shutdownProducer, kafkaStatus } from "./publisher";
import { logger } from "../lib/logger";

export interface EventSystemStatus {
  kafka_reachable: boolean;
  consumers_started: number;
  brokers: string;
}

/**
 * Try to start consumers. If Kafka isn't reachable, in-process fallback in publisher.ts
 * still triggers agents — so the app boots either way.
 */
export async function startEventSystem(): Promise<EventSystemStatus> {
  let started = 0;
  if (await startKitchenConsumer()) started++;
  if (await startInventoryConsumer()) started++;
  if (await startStockLowConsumer()) started++;

  const status = kafkaStatus();
  logger.info(
    { brokers: status.brokers, consumers_started: started, kafka_state: status.state },
    started > 0 ? "[EVENTS] system started (Kafka active)" : "[EVENTS] system started (in-process fallback mode)",
  );
  return {
    kafka_reachable: started > 0,
    consumers_started: started,
    brokers: status.brokers,
  };
}

export async function shutdownEventSystem(): Promise<void> {
  await shutdownConsumers();
  await shutdownProducer();
  logger.info("[EVENTS] system shutdown");
}

export * from "./types";
export {
  publishOrderCreated,
  publishIngredientConsumed,
  publishStockLow,
  publishTicketReady,
  kafkaStatus,
} from "./publisher";

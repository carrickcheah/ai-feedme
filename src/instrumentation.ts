/**
 * OpenTelemetry → Langfuse Cloud
 *
 * Ported from ai-contact-bun/ai_brain/src/instrumentation.ts. That repo exports
 * OTLP to self-hosted Tempo; here we point the same exporter at Langfuse Cloud's
 * OTLP ingestion endpoint instead.
 *
 * Langfuse Cloud accepts OTLP HTTP at:
 *   ${LANGFUSE_BASE_URL}/api/public/otel/v1/traces
 * authenticated with HTTP Basic ${public_key}:${secret_key}.
 *
 * MUST be imported at the very top of the entry point (index.ts) before any
 * other imports so the SDK starts before any HTTP client (openai, fetch) is
 * constructed.
 */

import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";

const enabled =
  (process.env.LANGFUSE_ENABLED ?? "false").toLowerCase() === "true" ||
  process.env.OTEL_ENABLED === "true";

let started = false;

if (enabled) {
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
  const secretKey = process.env.LANGFUSE_SECRET_KEY;
  const baseUrl = process.env.LANGFUSE_BASE_URL ?? "https://us.cloud.langfuse.com";

  if (!publicKey || !secretKey) {
    console.warn(
      "[OTEL] LANGFUSE_ENABLED=true but LANGFUSE_PUBLIC_KEY/SECRET_KEY missing — tracing disabled.",
    );
  } else {
    const url = `${baseUrl.replace(/\/$/, "")}/api/public/otel/v1/traces`;
    const auth = Buffer.from(`${publicKey}:${secretKey}`).toString("base64");

    const sdk = new NodeSDK({
      resource: resourceFromAttributes({
        [ATTR_SERVICE_NAME]: "ai-feedme",
        [ATTR_SERVICE_VERSION]: "0.1.0",
        "deployment.environment": process.env.NODE_ENV ?? "development",
      }),
      traceExporter: new OTLPTraceExporter({
        url,
        headers: { Authorization: `Basic ${auth}` },
      }),
    });

    sdk.start();
    started = true;

    const shutdown = () => {
      sdk
        .shutdown()
        .then(() => console.log("[OTEL] SDK shut down (traces flushed)."))
        .catch((e) => console.error("[OTEL] shutdown error:", e))
        .finally(() => process.exit(0));
    };
    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);

    console.log(`[OTEL] OpenTelemetry initialized → ${url}`);
    console.log(`[OTEL] Environment: ${process.env.NODE_ENV ?? "development"}`);
  }
}

if (!started) {
  console.log("[OTEL] Tracing disabled (set LANGFUSE_ENABLED=true to enable)");
}

export const isTracingEnabled = started;

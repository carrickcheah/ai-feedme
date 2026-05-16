/**
 * Tracing helpers — thin wrapper over @opentelemetry/api.
 *
 * Use traced() to wrap an async function in a span. Attributes are set up
 * front; errors are auto-recorded; success becomes OK status. Child HTTP
 * spans (openai SDK fetch, MCP HTTP, memgc HTTP) attach as children of
 * the active span automatically.
 *
 * No-ops cleanly when the OTel SDK is not started (instrumentation.ts
 * disabled). All calls return the wrapped function's value.
 */
import { trace, SpanStatusCode } from "@opentelemetry/api";
import type { Attributes } from "@opentelemetry/api";

const TRACER_NAME = "ai-feedme";

export function tracer() {
  return trace.getTracer(TRACER_NAME);
}

export async function traced<T>(
  name: string,
  attrs: Attributes,
  fn: () => Promise<T>,
): Promise<T> {
  return tracer().startActiveSpan(name, { attributes: attrs }, async (span) => {
    try {
      const result = await fn();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      span.recordException(err instanceof Error ? err : new Error(message));
      span.setStatus({ code: SpanStatusCode.ERROR, message });
      throw err;
    } finally {
      span.end();
    }
  });
}

/** Attach extra attributes to the currently active span (no-op if none). */
export function addSpanAttrs(attrs: Attributes): void {
  const span = trace.getActiveSpan();
  if (!span) return;
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== undefined && v !== null) span.setAttribute(k, v as never);
  }
}

# 007 — Observability

> Harness sub-domain #7 (Tier B, operational). Question it owns: **"How do I see what the agent did?"**
> Demo tenant: Awesome Healthcare (synthetic data).

## What observability is

The agent runs on its own, in the background, hundreds of times a day. Observability is the
**window** into what it did — so when something goes wrong you can *see* why instead of guessing.
Without it you're blind: a patient says "the AI gave a wrong price" and you have no record.
With it, you replay exactly what the agent saw and did.

## Three things you watch

| What | Tooling / SDK | Captures | Where |
|---|---|---|---|
| 📊 **Metrics** | custom collector + **Prometheus** | request path, status, latency, `account_id` | `metrics-collector.ts` → **TimescaleDB**, flushed every 60s |
| 🔍 **Traces** | **OpenTelemetry (OTLP)** → **Tempo** | step-by-step run (msg → tool → result → error) | `tracer.ts` + OTLP HTTP export (`:4318`) |
| 🚨 **Alerts** | custom `/alerts` + **Grafana** | error rates, MCP health, uptime | `observability.ts` |

## The stack

```
OpenTelemetry SDK → OTLP → Tempo (traces)
                          → Prometheus (metrics)  →  Grafana (dashboards)
custom metrics    → TimescaleDB
```

- **OTLP** = OpenTelemetry Protocol; the OpenTelemetry SDK emits traces, exported over OTLP HTTP to
  **Tempo** (`OTEL_SERVICE_NAME=ai-brain`, endpoint `:4318`).
- **Grafana** doesn't collect — it *visualizes*, reading traces from Tempo and metrics from Prometheus.

## The 3 questions it answers

- *Is it healthy?* → metrics
- *What did it do on this request?* → traces
- *Should I be worried right now?* → alerts

## Key point — tenant-scoped

Every metric carries `account_id`, so I can answer *"how is Awesome Healthcare's agent doing?"* —
per-tenant latency, errors, volume — not just system-wide averages. Same `account_id` thread that
runs through context, safety, and memory now runs through visibility too.

## Summary (precise)

Observability is the window into an autonomous agent. My harness records per-request metrics
(latency, status, tenant) to TimescaleDB + Prometheus, step-by-step execution traces via
OpenTelemetry/OTLP → Tempo → Grafana, and exposes health alerts — all tagged with `account_id`
so I can see each tenant's experience, not just system averages.

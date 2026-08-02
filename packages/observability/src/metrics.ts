import {
  collectDefaultMetrics,
  Counter,
  Gauge,
  Histogram,
  Registry,
} from "prom-client";

/**
 * One Prometheus metric catalog, shared by every service. Each service builds
 * its OWN registry (createMetrics) and updates the subset of instruments it
 * owns; the others report zero. Defining the full catalog everywhere keeps the
 * committed Grafana dashboard consistent — a panel querying `vd_turn_latency_*`
 * works whether or not the queried service emits it.
 *
 * Naming: Prometheus convention — snake_case, base-unit suffix (`_seconds`,
 * `_total`). All series carry a `service` default label so one dashboard can
 * filter by api / voice-gateway / workers.
 */

export type MetricService = "api" | "voice-gateway" | "workers";

/** The six turn-latency stages from docs/latency-budget.md, as metric labels. */
export const TURN_STAGES = [
  "stt_endpoint",
  "llm_ttft",
  "llm_total",
  "tool",
  "tts_ttfb",
  "turn_total",
] as const;
export type TurnStage = (typeof TURN_STAGES)[number];

// Buckets (seconds) aligned to the voice-to-voice budget: p50 ≤ 1.2s.
const TURN_BUCKETS = [0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.75, 1, 1.2, 1.5, 2, 3, 5];
const HTTP_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

export interface VaaniMetrics {
  readonly registry: Registry;
  /** api — request duration by method/route/status. */
  readonly httpRequestDuration: Histogram<"method" | "route" | "status_code">;
  /** gateway — live calls currently connected. */
  readonly callsInFlight: Gauge<string>;
  /** gateway — completed calls by direction and outcome. */
  readonly callsTotal: Counter<"direction" | "outcome">;
  /** gateway — per-turn latency by stage (seconds). */
  readonly turnLatency: Histogram<"stage">;
  /** gateway — external provider calls: provider × kind × result(ok|error|retry). */
  readonly providerRequests: Counter<"provider" | "kind" | "result">;
  /** gateway — barge-in events (caller interrupted the agent). */
  readonly bargeInTotal: Counter<string>;
  /** gateway — agent tool calls by tool and result. */
  readonly toolCalls: Counter<"tool" | "result">;
  /** gateway — guardrail triggers by type (abuse, price, turn_budget, silence…). */
  readonly guardrailTriggers: Counter<"type">;
  /** api — bookings created, for conversion (source × result). */
  readonly bookingsTotal: Counter<"source" | "result">;
  /** workers — jobs processed: queue × job_type × result. */
  readonly queueJobs: Counter<"queue" | "job_type" | "result">;
  /** workers — queue depth by state (waiting, delayed, failed…). */
  readonly queueDepth: Gauge<"queue" | "state">;
  /** api — webhook signature verification failures by provider. */
  readonly webhookSignatureFailures: Counter<"provider">;
}

export function createMetrics(service: MetricService): VaaniMetrics {
  const registry = new Registry();
  registry.setDefaultLabels({ service });
  // Node process/runtime metrics (event-loop lag, heap, GC, handles…).
  collectDefaultMetrics({ register: registry, prefix: "vd_node_" });

  const r = [registry];
  return {
    registry,
    httpRequestDuration: new Histogram({
      name: "vd_http_request_duration_seconds",
      help: "HTTP request duration in seconds",
      labelNames: ["method", "route", "status_code"],
      buckets: HTTP_BUCKETS,
      registers: r,
    }),
    callsInFlight: new Gauge({
      name: "vd_calls_in_flight",
      help: "Voice calls currently connected",
      registers: r,
    }),
    callsTotal: new Counter({
      name: "vd_calls_total",
      help: "Completed voice calls",
      labelNames: ["direction", "outcome"],
      registers: r,
    }),
    turnLatency: new Histogram({
      name: "vd_turn_latency_seconds",
      help: "Per-turn latency by pipeline stage",
      labelNames: ["stage"],
      buckets: TURN_BUCKETS,
      registers: r,
    }),
    providerRequests: new Counter({
      name: "vd_provider_requests_total",
      help: "External provider requests (stt/tts/llm/telephony/whatsapp)",
      labelNames: ["provider", "kind", "result"],
      registers: r,
    }),
    bargeInTotal: new Counter({
      name: "vd_barge_in_total",
      help: "Barge-in events (caller interrupted the agent)",
      registers: r,
    }),
    toolCalls: new Counter({
      name: "vd_tool_calls_total",
      help: "Agent tool calls",
      labelNames: ["tool", "result"],
      registers: r,
    }),
    guardrailTriggers: new Counter({
      name: "vd_guardrail_triggers_total",
      help: "Guardrail triggers by type",
      labelNames: ["type"],
      registers: r,
    }),
    bookingsTotal: new Counter({
      name: "vd_bookings_total",
      help: "Bookings created",
      labelNames: ["source", "result"],
      registers: r,
    }),
    queueJobs: new Counter({
      name: "vd_queue_jobs_total",
      help: "Queue jobs processed",
      labelNames: ["queue", "job_type", "result"],
      registers: r,
    }),
    queueDepth: new Gauge({
      name: "vd_queue_depth",
      help: "Queue depth by state",
      labelNames: ["queue", "state"],
      registers: r,
    }),
    webhookSignatureFailures: new Counter({
      name: "vd_webhook_signature_failures_total",
      help: "Webhook signature verification failures",
      labelNames: ["provider"],
      registers: r,
    }),
  };
}

/** Observe one turn stage in the histogram, converting milliseconds → seconds. */
export function observeTurnStage(metrics: VaaniMetrics, stage: TurnStage, ms: number): void {
  metrics.turnLatency.observe({ stage }, ms / 1000);
}

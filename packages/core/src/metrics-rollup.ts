import type { CallLatencyRollup, TurnMetrics, TurnMetricKey } from "./metrics.js";

const METRIC_KEYS: TurnMetricKey[] = [
  "sttEndpointMs",
  "llmTtftMs",
  "llmTotalMs",
  "toolMs",
  "ttsTtfbMs",
  "turnTotalMs",
];

/**
 * Nearest-rank percentile on a sorted copy — exact for the small per-call
 * sample sizes we roll up (a call has tens of turns, not millions).
 */
export function percentile(values: number[], p: number): number | undefined {
  if (values.length === 0) return undefined;
  if (p < 0 || p > 100) throw new Error(`percentile out of range: ${p}`);
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1];
}

/** Per-call latency rollup persisted on calls.latency_rollup at completion. */
export function rollupTurnMetrics(turns: TurnMetrics[]): CallLatencyRollup {
  const p50: TurnMetrics = {};
  const p95: TurnMetrics = {};
  for (const key of METRIC_KEYS) {
    const values = turns
      .map((turn) => turn[key])
      .filter((value): value is number => typeof value === "number");
    const v50 = percentile(values, 50);
    const v95 = percentile(values, 95);
    if (v50 !== undefined) p50[key] = Math.round(v50);
    if (v95 !== undefined) p95[key] = Math.round(v95);
  }
  return { turnCount: turns.length, p50, p95 };
}

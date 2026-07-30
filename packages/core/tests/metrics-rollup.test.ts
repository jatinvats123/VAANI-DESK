import { describe, expect, it } from "vitest";
import { percentile, rollupTurnMetrics } from "../src/metrics-rollup.js";

describe("percentile", () => {
  it("handles empty and single-value inputs", () => {
    expect(percentile([], 50)).toBeUndefined();
    expect(percentile([42], 50)).toBe(42);
    expect(percentile([42], 95)).toBe(42);
  });

  it("computes nearest-rank percentiles", () => {
    const values = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];
    expect(percentile(values, 50)).toBe(500);
    expect(percentile(values, 95)).toBe(1000);
    expect(percentile(values, 10)).toBe(100);
    expect(percentile([3, 1, 2], 50)).toBe(2); // unsorted input
  });

  it("rejects out-of-range p", () => {
    expect(() => percentile([1], 101)).toThrow();
    expect(() => percentile([1], -1)).toThrow();
  });
});

describe("rollupTurnMetrics", () => {
  it("rolls up only the keys that have samples", () => {
    const rollup = rollupTurnMetrics([
      { llmTtftMs: 400, turnTotalMs: 1100 },
      { llmTtftMs: 300, turnTotalMs: 900 },
      { llmTtftMs: 500, turnTotalMs: 1300, toolMs: 250 },
    ]);
    expect(rollup.turnCount).toBe(3);
    expect(rollup.p50.llmTtftMs).toBe(400);
    expect(rollup.p50.turnTotalMs).toBe(1100);
    expect(rollup.p50.toolMs).toBe(250);
    expect(rollup.p95.llmTtftMs).toBe(500);
    expect(rollup.p50.sttEndpointMs).toBeUndefined();
  });

  it("handles calls with no measured turns", () => {
    const rollup = rollupTurnMetrics([]);
    expect(rollup).toEqual({ turnCount: 0, p50: {}, p95: {} });
  });
});

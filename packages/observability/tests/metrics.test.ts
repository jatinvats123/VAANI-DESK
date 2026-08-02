import { describe, expect, it } from "vitest";
import { bearerMatches, createMetrics, observeTurnStage, renderMetrics, TURN_STAGES } from "../src/index.js";

/** Find the exposition line for a metric and assert it carries each label + value. */
function expectSeries(
  body: string,
  metric: string,
  labels: Record<string, string>,
  value: number,
): void {
  const line = body
    .split("\n")
    .find(
      (l) =>
        l.startsWith(metric + "{") &&
        Object.entries(labels).every(([k, v]) => l.includes(`${k}="${v}"`)),
    );
  expect(line, `no ${metric} line with labels ${JSON.stringify(labels)}`).toBeDefined();
  expect(line!.trim().endsWith(` ${value}`)).toBe(true);
}

describe("createMetrics", () => {
  it("builds an isolated registry with the service default label", async () => {
    const m = createMetrics("voice-gateway");
    m.callsTotal.inc({ direction: "inbound", outcome: "booking_created" });
    const { body, contentType } = await renderMetrics(m.registry);
    expect(contentType).toContain("text/plain");
    expectSeries(
      body,
      "vd_calls_total",
      { service: "voice-gateway", direction: "inbound", outcome: "booking_created" },
      1,
    );
    // Node default metrics are present with the vd_node_ prefix.
    expect(body).toMatch(/vd_node_/);
  });

  it("two services get independent registries (no cross-contamination)", async () => {
    const api = createMetrics("api");
    const gw = createMetrics("voice-gateway");
    api.webhookSignatureFailures.inc({ provider: "twilio" });
    const apiBody = await renderMetrics(api.registry).then((r) => r.body);
    const gwBody = await renderMetrics(gw.registry).then((r) => r.body);
    expectSeries(apiBody, "vd_webhook_signature_failures_total", { service: "api", provider: "twilio" }, 1);
    // The gateway registry never saw that increment.
    expect(gwBody).not.toContain('provider="twilio"');
  });

  it("records all six turn-latency stages in seconds", async () => {
    const m = createMetrics("voice-gateway");
    for (const stage of TURN_STAGES) observeTurnStage(m, stage, 400); // 400ms → 0.4s
    const body = await renderMetrics(m.registry).then((r) => r.body);
    for (const stage of TURN_STAGES) {
      expectSeries(body, "vd_turn_latency_seconds_count", { stage }, 1);
      // 0.4s falls in the ≤0.4 bucket (cumulative count 1).
      expectSeries(body, "vd_turn_latency_seconds_bucket", { stage, le: "0.4" }, 1);
    }
  });
});

describe("bearerMatches", () => {
  const secret = "internal-service-secret-123456";
  it("accepts the exact bearer token", () => {
    expect(bearerMatches(`Bearer ${secret}`, secret)).toBe(true);
  });
  it("rejects missing, malformed, wrong, and wrong-length tokens", () => {
    expect(bearerMatches(undefined, secret)).toBe(false);
    expect(bearerMatches("Basic abc", secret)).toBe(false);
    expect(bearerMatches("Bearer wrong", secret)).toBe(false);
    expect(bearerMatches(`Bearer ${secret}x`, secret)).toBe(false);
    expect(bearerMatches(`Bearer ${secret}`, "")).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { ALL_SCENARIOS } from "../src/scenarios/index.js";

/**
 * Suite integrity: the 30-scenario deliverable stays 30, internally consistent,
 * and structurally runnable — broken fixtures fail here, not mid-eval-run.
 */
describe("scenario suite", () => {
  it("contains exactly 30 uniquely named scenarios", () => {
    expect(ALL_SCENARIOS).toHaveLength(30);
    expect(new Set(ALL_SCENARIOS.map((s) => s.name)).size).toBe(30);
  });

  it("every scenario has a non-empty script, tags, and at least one assertion", () => {
    for (const scenario of ALL_SCENARIOS) {
      expect(scenario.persona.script.length, scenario.name).toBeGreaterThan(0);
      expect(scenario.tags.length, scenario.name).toBeGreaterThan(0);
      expect(scenario.assertions.length, scenario.name).toBeGreaterThan(0);
      expect(scenario.description.length, scenario.name).toBeGreaterThan(10);
    }
  });

  it("assertion and fixture service references resolve within the fixture", () => {
    for (const scenario of ALL_SCENARIOS) {
      const serviceIds = new Set(scenario.fixture.services.map((s) => s.id));
      for (const assertion of scenario.assertions) {
        if (assertion.kind === "booking_created" && assertion.serviceId !== undefined) {
          expect(
            serviceIds.has(assertion.serviceId),
            `${scenario.name}: ${assertion.serviceId}`,
          ).toBe(true);
        }
      }
      for (const seeded of scenario.fixture.existingBookings ?? []) {
        expect(serviceIds.has(seeded.serviceId), scenario.name).toBe(true);
      }
    }
  });

  it("fixture clocks are pinned instants (deterministic runs)", () => {
    for (const scenario of ALL_SCENARIOS) {
      expect(Number.isNaN(Date.parse(scenario.fixture.nowIso)), scenario.name).toBe(false);
    }
  });

  it("agent_says / agent_never_says patterns are valid regexes", () => {
    for (const scenario of ALL_SCENARIOS) {
      for (const assertion of scenario.assertions) {
        if (assertion.kind === "agent_says" || assertion.kind === "agent_never_says") {
          expect(() => new RegExp(assertion.pattern, assertion.flags ?? "i")).not.toThrow();
        }
      }
    }
  });
});

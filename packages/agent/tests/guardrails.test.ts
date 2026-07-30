import { describe, expect, it } from "vitest";
import {
  containsAbuse,
  extractSpokenAmountsPaise,
  findUnauthorizedAmounts,
  GUARDRAIL_LIMITS,
  initialBudget,
  nextBudgetState,
  type BudgetEvent,
  type CallBudgetState,
} from "../src/guardrails.js";

function run(events: BudgetEvent[]): { state: CallBudgetState; decisions: string[] } {
  let state = initialBudget();
  const decisions: string[] = [];
  for (const event of events) {
    const result = nextBudgetState(state, event);
    state = result.state;
    decisions.push(result.decision.action);
  }
  return { state, decisions };
}

describe("budget reducer", () => {
  it("continues through a normal short call", () => {
    const { decisions } = run([
      { type: "agent_turn" },
      { type: "caller_spoke" },
      { type: "tool_success" },
      { type: "agent_turn" },
    ]);
    expect(new Set(decisions)).toEqual(new Set(["continue"]));
  });

  it("transfers when the turn budget is exhausted", () => {
    const events: BudgetEvent[] = Array.from(
      { length: GUARDRAIL_LIMITS.maxAgentTurns },
      () => ({ type: "agent_turn" }) as const,
    );
    const { decisions } = run(events);
    expect(decisions.at(-1)).toBe("transfer");
    expect(decisions.slice(0, -1).every((d) => d === "continue")).toBe(true);
  });

  it("transfers after repeated tool failures, but success resets the streak", () => {
    const failing = run([
      { type: "tool_failure" },
      { type: "tool_failure" },
      { type: "tool_failure" },
    ]);
    expect(failing.decisions).toEqual(["continue", "continue", "transfer"]);

    const recovered = run([
      { type: "tool_failure" },
      { type: "tool_failure" },
      { type: "tool_success" },
      { type: "tool_failure" },
      { type: "tool_failure" },
    ]);
    expect(recovered.decisions.at(-1)).toBe("continue");
  });

  it("warns once on abuse, ends on the second", () => {
    const { decisions } = run([{ type: "abuse_detected" }, { type: "abuse_detected" }]);
    expect(decisions).toEqual(["warn_abuse", "end"]);
  });

  it("gives up after repeated silence, but speech resets the counter", () => {
    const silent = run([{ type: "silence" }, { type: "silence" }, { type: "silence" }]);
    expect(silent.decisions).toEqual(["continue", "continue", "end"]);

    const spoke = run([
      { type: "silence" },
      { type: "silence" },
      { type: "caller_spoke" },
      { type: "silence" },
    ]);
    expect(spoke.decisions.at(-1)).toBe("continue");
  });
});

describe("containsAbuse", () => {
  it("flags English and romanized Hindi abuse", () => {
    expect(containsAbuse("fuck this")).toBe(true);
    expect(containsAbuse("abbe chutiya hai kya")).toBe(true);
    expect(containsAbuse("saala harami")).toBe(true);
  });

  it("stays quiet on normal booking talk", () => {
    expect(containsAbuse("kal shaam haircut chahiye")).toBe(false);
    expect(containsAbuse("What are your charges for facial?")).toBe(false);
    // Words containing risky substrings must not trip it.
    expect(containsAbuse("please book kar do")).toBe(false);
  });
});

describe("spoken amount extraction", () => {
  it("finds amounts in the formats the agent speaks", () => {
    expect(extractSpokenAmountsPaise("Haircut is ₹400")).toEqual([40000]);
    expect(extractSpokenAmountsPaise("that will be 400 rupees")).toEqual([40000]);
    expect(extractSpokenAmountsPaise("Rs. 2,500 for colour")).toEqual([250000]);
    expect(extractSpokenAmountsPaise("chaar sau matlab 400 rupaye")).toEqual([40000]);
    expect(new Set(extractSpokenAmountsPaise("₹400 ya rupees 150"))).toEqual(
      new Set([40000, 15000]),
    );
  });

  it("ignores non-monetary numbers", () => {
    expect(extractSpokenAmountsPaise("kal shaam 5:30 baje, 30 minute lagega")).toEqual([]);
  });
});

describe("findUnauthorizedAmounts", () => {
  const allowed = [40000, 250000];

  it("passes utterances that only quote allowed prices", () => {
    expect(findUnauthorizedAmounts("Haircut ₹400, colour ₹2,500", allowed)).toEqual([]);
  });

  it("catches invented prices", () => {
    expect(findUnauthorizedAmounts("Discount de dunga, sirf 350 rupees", allowed)).toEqual([35000]);
  });

  it("passes utterances with no amounts", () => {
    expect(findUnauthorizedAmounts("Kal shaam 5:30 free hai", allowed)).toEqual([]);
  });
});

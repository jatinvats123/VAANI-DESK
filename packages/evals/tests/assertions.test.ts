import { describe, expect, it } from "vitest";
import { evaluateAssertions } from "../src/assertions.js";
import type { ConversationResult } from "../src/types.js";

function result(overrides: Partial<ConversationResult> = {}): ConversationResult {
  return {
    turns: [
      { role: "caller", text: "Kal haircut milega?" },
      {
        role: "agent",
        text: "Ji, kal 5 baje free hai, 400 rupees. Book kar doon?",
        toolCalls: [{ name: "check_availability", input: {}, ok: true }],
      },
      { role: "caller", text: "Haan" },
      {
        role: "agent",
        text: "Done! Kal shaam 5 baje confirmed.",
        toolCalls: [{ name: "create_booking", input: {}, ok: true }],
      },
    ],
    toolCalls: [
      { name: "check_availability", input: {}, ok: true },
      { name: "create_booking", input: {}, ok: true },
    ],
    bookings: [
      {
        id: "b1",
        serviceId: "svc-1",
        startsAtIso: "2026-07-18T11:30:00.000Z",
        customerName: "Rohit",
        customerPhone: "+919876543210",
        status: "confirmed",
      },
    ],
    transferRequested: false,
    endRequested: false,
    abuseWarnings: 0,
    allowedAmounts: [40000],
    usage: { inputTokens: 0, outputTokens: 0 },
    ...overrides,
  };
}

describe("evaluateAssertions", () => {
  it("passes the happy path bundle", () => {
    const failures = evaluateAssertions(
      [
        { kind: "booking_created", serviceId: "svc-1" },
        { kind: "no_unauthorized_amounts" },
        { kind: "no_transfer" },
        { kind: "tool_called", name: "create_booking" },
        { kind: "max_agent_turns", max: 3 },
        { kind: "agent_says", pattern: "confirmed" },
      ],
      result(),
    );
    expect(failures).toEqual([]);
  });

  it("catches missing bookings, wrong service, unexpected bookings", () => {
    expect(
      evaluateAssertions([{ kind: "booking_created" }], result({ bookings: [] })),
    ).toHaveLength(1);
    expect(
      evaluateAssertions([{ kind: "booking_created", serviceId: "other" }], result()),
    ).toHaveLength(1);
    expect(evaluateAssertions([{ kind: "no_booking_created" }], result())).toHaveLength(1);
  });

  it("flags unauthorized amounts via the shared guardrail", () => {
    const r = result({
      turns: [{ role: "agent", text: "Aapke liye special 350 rupees kar dunga." }],
      allowedAmounts: [40000],
    });
    const failures = evaluateAssertions([{ kind: "no_unauthorized_amounts" }], r);
    expect(failures).toHaveLength(1);
    expect(failures[0]!.detail).toContain("35000");
  });

  it("checks transfer / end / tool-call expectations", () => {
    const transferred = result({ transferRequested: true, transferReason: "asked" });
    expect(evaluateAssertions([{ kind: "transfer_requested" }], transferred)).toEqual([]);
    expect(evaluateAssertions([{ kind: "no_transfer" }], transferred)).toHaveLength(1);
    expect(evaluateAssertions([{ kind: "transfer_requested" }], result())).toHaveLength(1);

    const ended = result({ endRequested: true, endReason: "abusive" });
    expect(evaluateAssertions([{ kind: "call_ended", reason: "abusive" }], ended)).toEqual([]);
    expect(evaluateAssertions([{ kind: "call_ended", reason: "done" }], ended)).toHaveLength(1);

    expect(
      evaluateAssertions([{ kind: "tool_called", name: "cancel_booking" }], result()),
    ).toHaveLength(1);
    expect(
      evaluateAssertions([{ kind: "tool_not_called", name: "create_booking" }], result()),
    ).toHaveLength(1);
  });

  it("agent_says / agent_never_says use case-insensitive regex over agent text only", () => {
    expect(evaluateAssertions([{ kind: "agent_says", pattern: "CONFIRMED" }], result())).toEqual(
      [],
    );
    // "haircut" appears only in caller text.
    expect(
      evaluateAssertions([{ kind: "agent_says", pattern: "haircut milega" }], result()),
    ).toHaveLength(1);
    expect(
      evaluateAssertions([{ kind: "agent_never_says", pattern: "400 rupees" }], result()),
    ).toHaveLength(1);
  });
});

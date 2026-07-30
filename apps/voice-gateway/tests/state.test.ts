import { describe, expect, it } from "vitest";
import {
  acceptsCallerAudio,
  CALL_STATES,
  canTransitionCall,
  isInterruptible,
  isTerminalCallState,
} from "../src/call/state.js";

describe("call state machine", () => {
  it("allows the happy path", () => {
    expect(canTransitionCall("connecting", "greeting")).toBe(true);
    expect(canTransitionCall("greeting", "listening")).toBe(true);
    expect(canTransitionCall("listening", "thinking")).toBe(true);
    expect(canTransitionCall("thinking", "speaking")).toBe(true);
    expect(canTransitionCall("speaking", "listening")).toBe(true);
  });

  it("allows barge-in and tool-round loops", () => {
    expect(canTransitionCall("speaking", "thinking")).toBe(true); // next turn during playback tail
    expect(canTransitionCall("thinking", "listening")).toBe(true); // empty LLM response
  });

  it("every state can reach done (hangups race everything)", () => {
    for (const state of CALL_STATES) {
      if (state === "done") continue;
      expect(canTransitionCall(state, "done")).toBe(true);
    }
  });

  it("blocks resurrection and skips", () => {
    expect(canTransitionCall("done", "listening")).toBe(false);
    expect(canTransitionCall("connecting", "speaking")).toBe(false);
    expect(canTransitionCall("transferring", "listening")).toBe(false);
    expect(canTransitionCall("ending", "listening")).toBe(false);
  });

  it("terminal / audio / interrupt predicates agree with the table", () => {
    expect(isTerminalCallState("done")).toBe(true);
    expect(isTerminalCallState("speaking")).toBe(false);
    expect(acceptsCallerAudio("listening")).toBe(true);
    expect(acceptsCallerAudio("transferring")).toBe(false);
    expect(acceptsCallerAudio("done")).toBe(false);
    expect(isInterruptible("speaking")).toBe(true);
    expect(isInterruptible("greeting")).toBe(false); // consent notice always completes
  });
});

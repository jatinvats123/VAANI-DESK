import { describe, expect, it } from "vitest";
import { TurnTimer } from "../src/call/latency.js";

function timerAt(times: number[]): TurnTimer {
  let i = 0;
  return new TurnTimer(() => times[Math.min(i++, times.length - 1)]!);
}

describe("TurnTimer", () => {
  it("derives the budget metrics from stage stamps", () => {
    // speechEnd=0, llmSent=10, firstToken=410, ttsFirstByte=700, firstAudio=750, llmDone=900
    const timer = timerAt([0, 10, 410, 700, 750, 900]);
    timer.mark("callerSpeechEnd");
    timer.mark("llmRequestSent");
    timer.mark("llmFirstToken");
    timer.mark("ttsFirstByte");
    timer.mark("firstAudioSent");
    timer.markLlmCompleted();

    expect(timer.finish()).toEqual({
      llmTtftMs: 400,
      llmTotalMs: 890,
      ttsTtfbMs: 290,
      turnTotalMs: 750,
    });
  });

  it("first occurrence wins for first-* stamps; llmCompleted re-stamps", () => {
    const timer = timerAt([0, 100, 200, 300, 400, 500]);
    timer.mark("llmRequestSent"); // 0
    timer.mark("llmFirstToken"); // 100
    timer.markLlmCompleted(); // 200 (tool round 1)
    timer.mark("llmRequestSent"); // ignored (250 not consumed — first wins)
    timer.mark("llmFirstToken"); // ignored
    timer.markLlmCompleted(); // re-stamped later

    const metrics = timer.finish();
    expect(metrics.llmTtftMs).toBe(100);
    expect(metrics.llmTotalMs).toBeGreaterThan(200);
  });

  it("accumulates tool time across rounds", () => {
    const timer = timerAt([0, 250, 300, 450, 1000]);
    timer.mark("toolStarted"); // 0
    timer.mark("toolCompleted"); // 250 → +250
    timer.mark("toolStarted"); // 300
    timer.mark("toolCompleted"); // 450 → +150
    expect(timer.finish().toolMs).toBe(400);
  });

  it("omits metrics whose stamps never happened", () => {
    const timer = timerAt([0, 100]);
    timer.mark("callerSpeechEnd");
    expect(timer.finish()).toEqual({});
  });
});

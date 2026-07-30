import type { TurnMetrics } from "@vaanidesk/core";

/**
 * Per-turn latency stamping (docs/latency-budget.md). The session marks stage
 * boundaries; `finish()` derives the metrics persisted on the turn record.
 * Injectable clock keeps it deterministic under test.
 */

export type TurnStamp =
  | "callerSpeechEnd" // STT endpoint decided the caller finished
  | "llmRequestSent"
  | "llmFirstToken"
  | "llmCompleted"
  | "toolStarted"
  | "toolCompleted"
  | "ttsFirstByte" // first synthesized audio byte for this turn
  | "firstAudioSent"; // first media frame handed to Twilio

export class TurnTimer {
  private readonly stamps = new Map<TurnStamp, number>();
  private toolMsTotal = 0;
  private lastToolStart: number | undefined;

  constructor(private readonly now: () => number = () => performance.now()) {}

  mark(stamp: TurnStamp): void {
    const t = this.now();
    if (stamp === "toolStarted") {
      this.lastToolStart = t;
      return;
    }
    if (stamp === "toolCompleted") {
      if (this.lastToolStart !== undefined) {
        this.toolMsTotal += t - this.lastToolStart;
        this.lastToolStart = undefined;
      }
      return;
    }
    // First occurrence wins for "first-*" stamps; llmRequestSent may repeat on
    // tool rounds — the first request is the latency-relevant one.
    if (!this.stamps.has(stamp)) this.stamps.set(stamp, t);
  }

  /** Explicitly re-stampable: llmCompleted moves with each tool round. */
  markLlmCompleted(): void {
    this.stamps.set("llmCompleted", this.now());
  }

  finish(): TurnMetrics {
    const metrics: TurnMetrics = {};
    const delta = (from: TurnStamp, to: TurnStamp): number | undefined => {
      const a = this.stamps.get(from);
      const b = this.stamps.get(to);
      return a !== undefined && b !== undefined && b >= a ? Math.round(b - a) : undefined;
    };

    const llmTtft = delta("llmRequestSent", "llmFirstToken");
    if (llmTtft !== undefined) metrics.llmTtftMs = llmTtft;
    const llmTotal = delta("llmRequestSent", "llmCompleted");
    if (llmTotal !== undefined) metrics.llmTotalMs = llmTotal;
    const ttsTtfb = delta("llmFirstToken", "ttsFirstByte");
    if (ttsTtfb !== undefined) metrics.ttsTtfbMs = ttsTtfb;
    const total = delta("callerSpeechEnd", "firstAudioSent");
    if (total !== undefined) metrics.turnTotalMs = total;
    if (this.toolMsTotal > 0) metrics.toolMs = Math.round(this.toolMsTotal);
    return metrics;
  }
}

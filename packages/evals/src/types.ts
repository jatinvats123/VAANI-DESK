import type { TokenUsage, ToolCallRecord } from "@vaanidesk/core";
import type { AgentLanguage, BusinessHours, PromptConfig } from "@vaanidesk/shared";

/**
 * Scenario model: repo-versioned TypeScript fixtures (reviewable diffs, typed
 * assertions) synced into eval_cases at run time. A scenario is a business
 * fixture + a scripted caller + hard assertions + judge guidance.
 */

export interface EvalServiceFixture {
  /** Stable id so scripts and assertions can reference services. */
  id: string;
  name: string;
  durationMin: number;
  pricePaise: number;
  description?: string;
}

export interface EvalBusinessFixture {
  name: string;
  timezone: string;
  hours: BusinessHours;
  promptConfig: PromptConfig;
  services: EvalServiceFixture[];
  policy: {
    slotGranularityMin: number;
    bookingBufferMin: number;
    minNoticeMin: number;
    maxAdvanceDays: number;
  };
  /** Deterministic clock: "now" for the whole scenario (ISO instant). */
  nowIso: string;
  /** Pre-existing bookings occupying capacity (UTC ISO instants). */
  existingBookings?: Array<{
    serviceId: string;
    startsAtIso: string;
    customerPhone?: string;
    customerName?: string;
  }>;
  /** Pool size; defaults to 1. */
  activeResources?: number;
}

export type HardAssertion =
  | { kind: "booking_created"; serviceId?: string; startsAtIso?: string }
  | { kind: "no_booking_created" }
  | { kind: "booking_cancelled" }
  | { kind: "no_unauthorized_amounts" }
  | { kind: "transfer_requested" }
  | { kind: "no_transfer" }
  | { kind: "call_ended"; reason?: string }
  | { kind: "tool_called"; name: string; minTimes?: number }
  | { kind: "tool_not_called"; name: string }
  | { kind: "agent_says"; pattern: string; flags?: string }
  | { kind: "agent_never_says"; pattern: string; flags?: string }
  | { kind: "max_agent_turns"; max: number };

export interface EvalScenario {
  /** Stable slug — eval_cases sync key, e.g. "hinglish-basic-booking". */
  name: string;
  description: string;
  tags: string[];
  persona: {
    language: AgentLanguage;
    /** Caller utterances, played in order. The run ends early on transfer/end. */
    script: string[];
    callerPhone?: string;
  };
  fixture: EvalBusinessFixture;
  assertions: HardAssertion[];
  /** Extra rubric lines for the judge, e.g. "must quote ₹400 exactly". */
  judgeNotes?: string[];
}

// ── Run artifacts ───────────────────────────────────────────────────────────

export interface ConversationTurn {
  role: "caller" | "agent";
  text: string;
  toolCalls?: ToolCallRecord[];
}

export interface BookingRecord {
  id: string;
  serviceId: string;
  startsAtIso: string;
  customerName: string;
  customerPhone: string;
  status: "confirmed" | "cancelled";
}

export interface ConversationResult {
  turns: ConversationTurn[];
  toolCalls: ToolCallRecord[];
  bookings: BookingRecord[];
  transferRequested: boolean;
  transferReason?: string;
  endRequested: boolean;
  endReason?: string;
  abuseWarnings: number;
  /** Prices the agent was allowed to speak (fixture + tool results), paise. */
  allowedAmounts: number[];
  usage: TokenUsage;
  /** Runner-level failure (LLM error, etc.) — scenario becomes verdict "error". */
  runError?: string;
}

export interface AssertionFailure {
  assertion: HardAssertion;
  detail: string;
}

export interface JudgeVerdict {
  score: number; // 0..1
  reasoning: string;
}

export interface ScenarioOutcome {
  scenario: EvalScenario;
  result: ConversationResult;
  assertionFailures: AssertionFailure[];
  judge?: JudgeVerdict;
  verdict: "pass" | "fail" | "error";
  costPaise: number;
  durationMs: number;
}

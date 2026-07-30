/**
 * Call-level guardrails as a pure reducer: the gateway feeds events, gets back
 * the next state and a decision. No I/O, no clock — exhaustively unit-tested,
 * and the eval harness replays the same reducer to assert behavior.
 */

export const GUARDRAIL_LIMITS = {
  /** Agent speaking turns before forcing a human handoff. */
  maxAgentTurns: 20,
  /** Consecutive failed tool calls before handoff. */
  maxConsecutiveToolFailures: 2,
  /** Abuse warnings before ending the call. */
  maxAbuseWarnings: 1,
  /** Re-prompts on caller silence before giving up. */
  maxSilenceReprompts: 2,
} as const;

export interface CallBudgetState {
  agentTurns: number;
  consecutiveToolFailures: number;
  abuseWarnings: number;
  silenceReprompts: number;
}

export function initialBudget(): CallBudgetState {
  return { agentTurns: 0, consecutiveToolFailures: 0, abuseWarnings: 0, silenceReprompts: 0 };
}

export type BudgetEvent =
  | { type: "agent_turn" }
  | { type: "tool_failure" }
  | { type: "tool_success" }
  | { type: "caller_spoke" }
  | { type: "abuse_detected" }
  | { type: "silence" };

export type BudgetDecision =
  | { action: "continue" }
  | { action: "warn_abuse" }
  | { action: "transfer"; reason: string }
  | { action: "end"; reason: "abusive" | "caller_unresponsive" };

export function nextBudgetState(
  state: CallBudgetState,
  event: BudgetEvent,
): { state: CallBudgetState; decision: BudgetDecision } {
  switch (event.type) {
    case "agent_turn": {
      const next = { ...state, agentTurns: state.agentTurns + 1 };
      if (next.agentTurns >= GUARDRAIL_LIMITS.maxAgentTurns) {
        return { state: next, decision: { action: "transfer", reason: "turn budget exhausted" } };
      }
      return { state: next, decision: { action: "continue" } };
    }
    case "tool_failure": {
      const next = { ...state, consecutiveToolFailures: state.consecutiveToolFailures + 1 };
      if (next.consecutiveToolFailures > GUARDRAIL_LIMITS.maxConsecutiveToolFailures) {
        return {
          state: next,
          decision: { action: "transfer", reason: "repeated tool failures" },
        };
      }
      return { state: next, decision: { action: "continue" } };
    }
    case "tool_success":
      return { state: { ...state, consecutiveToolFailures: 0 }, decision: { action: "continue" } };
    case "caller_spoke":
      return { state: { ...state, silenceReprompts: 0 }, decision: { action: "continue" } };
    case "abuse_detected": {
      const next = { ...state, abuseWarnings: state.abuseWarnings + 1 };
      if (next.abuseWarnings > GUARDRAIL_LIMITS.maxAbuseWarnings) {
        return { state: next, decision: { action: "end", reason: "abusive" } };
      }
      return { state: next, decision: { action: "warn_abuse" } };
    }
    case "silence": {
      const next = { ...state, silenceReprompts: state.silenceReprompts + 1 };
      if (next.silenceReprompts > GUARDRAIL_LIMITS.maxSilenceReprompts) {
        return { state: next, decision: { action: "end", reason: "caller_unresponsive" } };
      }
      return { state: next, decision: { action: "continue" } };
    }
  }
}

// ── Abuse detection ─────────────────────────────────────────────────────────
// Deliberately conservative keyword matching (English + romanized Hindi):
// false negatives cost a warning turn; false positives hang up on customers.

const ABUSE_PATTERNS: RegExp[] = [
  /\bf+u+c*k+/i,
  /\bbastard\b/i,
  /\bbhen ?ch[ou]d/i,
  /\bmadar ?ch[ou]d/i,
  /\bbh?o?sdi ?k[ea]/i,
  /\bchutiy[ae]/i,
  /\bharami\b/i,
  /\bkamin[ae]\b/i,
  /\bsaal[ea] kutt[ea]\b/i,
];

export function containsAbuse(text: string): boolean {
  return ABUSE_PATTERNS.some((pattern) => pattern.test(text));
}

// ── Price hallucination detection ───────────────────────────────────────────

const AMOUNT_PATTERNS: RegExp[] = [
  /₹\s*([\d,]+(?:\.\d{1,2})?)/g,
  /\brs\.?\s*([\d,]+(?:\.\d{1,2})?)/gi,
  /\brupees?\s*([\d,]+(?:\.\d{1,2})?)/gi,
  /\b([\d,]+(?:\.\d{1,2})?)\s*(?:rupees?|rupay[ae]|rupaiy[ae])\b/gi,
];

/** Rupee amounts spoken in an utterance, as paise. */
export function extractSpokenAmountsPaise(text: string): number[] {
  const amounts = new Set<number>();
  for (const pattern of AMOUNT_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const raw = match[1]?.replace(/,/g, "");
      if (!raw) continue;
      const rupees = Number(raw);
      if (Number.isFinite(rupees) && rupees > 0) {
        amounts.add(Math.round(rupees * 100));
      }
    }
  }
  return [...amounts];
}

/**
 * Amounts in an agent utterance that appear nowhere in the allowed set
 * (service prices + amounts from tool results this call). Non-empty result =
 * the model spoke a number it wasn't given: logged as a guardrail violation
 * and asserted on by the eval suite.
 */
export function findUnauthorizedAmounts(
  utterance: string,
  allowedPaise: Iterable<number>,
): number[] {
  const allowed = new Set(allowedPaise);
  return extractSpokenAmountsPaise(utterance).filter((amount) => !allowed.has(amount));
}

/**
 * Per-call state machine — pure transition table, executed by CallSession.
 *
 *   connecting → greeting → listening ⇄ thinking → speaking → listening …
 *                                │                    │
 *                                └──── transferring / ending → done
 *
 * `speaking → listening` also fires on barge-in. Any state can reach `done`
 * (caller hangup / provider stop / fatal error).
 */

export const CALL_STATES = [
  "connecting",
  "greeting",
  "listening",
  "thinking",
  "speaking",
  "transferring",
  "ending",
  "done",
] as const;

export type CallState = (typeof CALL_STATES)[number];

const TRANSITIONS: Record<CallState, readonly CallState[]> = {
  connecting: ["greeting", "done"],
  greeting: ["listening", "transferring", "ending", "done"],
  listening: ["thinking", "transferring", "ending", "done"],
  thinking: ["speaking", "listening", "transferring", "ending", "done"],
  speaking: ["listening", "thinking", "transferring", "ending", "done"],
  transferring: ["done"],
  ending: ["done"],
  done: [],
};

export function canTransitionCall(from: CallState, to: CallState): boolean {
  return TRANSITIONS[from].includes(to);
}

export function isTerminalCallState(state: CallState): boolean {
  return TRANSITIONS[state].length === 0;
}

/** States in which inbound caller audio should be forwarded to STT. */
export function acceptsCallerAudio(state: CallState): boolean {
  return (
    state === "greeting" || state === "listening" || state === "thinking" || state === "speaking"
  );
}

/** States in which detected caller speech triggers barge-in handling. */
export function isInterruptible(state: CallState): boolean {
  return state === "speaking";
}

/**
 * Cost/latency/token accounting shapes shared by the voice gateway (producer),
 * the DB jsonb columns (storage), and the dashboard (display). All latencies in
 * milliseconds, all money in integer paise. See docs/latency-budget.md for the
 * stage definitions and budgets these fields correspond to.
 */

export interface TurnMetrics {
  /** Caller end-of-speech → STT endpoint decision. */
  sttEndpointMs?: number;
  /** LLM request sent → first streamed token. */
  llmTtftMs?: number;
  /** LLM request sent → completion finished. */
  llmTotalMs?: number;
  /** Tool round-trip (gateway → api → DB → back), when the turn used tools. */
  toolMs?: number;
  /** First sentence chunk → first TTS audio byte. */
  ttsTtfbMs?: number;
  /** Caller end-of-speech → first reply audio byte ("voice-to-voice"). */
  turnTotalMs?: number;
}

export type TurnMetricKey = keyof TurnMetrics;

export interface CallLatencyRollup {
  turnCount: number;
  p50: TurnMetrics;
  p95: TurnMetrics;
}

export interface CallCostBreakdown {
  sttPaise?: number;
  llmPaise?: number;
  ttsPaise?: number;
  telephonyPaise?: number;
  whatsappPaise?: number;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

/** One tool invocation as recorded on a call turn — the audit trail for "the agent only speaks DB truth". */
export interface ToolCallRecord {
  name: string;
  input?: unknown;
  ok: boolean;
  /** Tool output when ok, structured error otherwise. */
  result?: unknown;
  durationMs?: number;
}

import type { TokenUsage } from "@vaanidesk/core";

/**
 * LLM cost accounting in integer paise. Prices are configuration, not truth —
 * defaults below assume list API pricing at ₹90/USD and MUST be overridden via
 * config when rates or models change (they are also logged per call, so drift
 * is visible in the dashboard, not silently wrong).
 */

export interface ModelPricing {
  inputPaisePerMTok: number;
  outputPaisePerMTok: number;
  /** Defaults to 10% of input (Anthropic cache-read pricing). */
  cacheReadPaisePerMTok?: number;
  /** Defaults to 125% of input (Anthropic 5m cache-write pricing). */
  cacheWritePaisePerMTok?: number;
}

export const DEFAULT_MODEL_PRICING: Record<string, ModelPricing> = {
  // $1 / $5 per MTok at ₹90/USD
  "claude-haiku-4-5": { inputPaisePerMTok: 9_000, outputPaisePerMTok: 45_000 },
  "claude-haiku-4-5-20251001": { inputPaisePerMTok: 9_000, outputPaisePerMTok: 45_000 },
  // $3 / $15 per MTok at ₹90/USD
  "claude-sonnet-5": { inputPaisePerMTok: 27_000, outputPaisePerMTok: 135_000 },
  // Gemini free tier — no charge (ADR-0009). The "-latest" aliases are the ones
  // that carry free-tier quota. Paid tier / Vertex AI must override these via
  // config with real rates before billing customers on Gemini.
  "gemini-flash-latest": { inputPaisePerMTok: 0, outputPaisePerMTok: 0 },
  "gemini-flash-lite-latest": { inputPaisePerMTok: 0, outputPaisePerMTok: 0 },
  "gemini-2.0-flash-lite": { inputPaisePerMTok: 0, outputPaisePerMTok: 0 },
  "gemini-2.0-flash": { inputPaisePerMTok: 0, outputPaisePerMTok: 0 },
};

export function pricingForModel(
  model: string,
  overrides: Record<string, ModelPricing> = {},
): ModelPricing | undefined {
  return overrides[model] ?? DEFAULT_MODEL_PRICING[model];
}

/** Cost of one usage report, rounded up — costs never round to free. */
export function computeLlmCostPaise(usage: TokenUsage, pricing: ModelPricing): number {
  const cacheRead = pricing.cacheReadPaisePerMTok ?? pricing.inputPaisePerMTok * 0.1;
  const cacheWrite = pricing.cacheWritePaisePerMTok ?? pricing.inputPaisePerMTok * 1.25;
  const cost =
    (usage.inputTokens / 1_000_000) * pricing.inputPaisePerMTok +
    (usage.outputTokens / 1_000_000) * pricing.outputPaisePerMTok +
    ((usage.cacheReadTokens ?? 0) / 1_000_000) * cacheRead +
    ((usage.cacheWriteTokens ?? 0) / 1_000_000) * cacheWrite;
  return Math.ceil(cost);
}

/** Accumulates usage across a call's turns (streaming deltas or per-turn reports). */
export function addTokenUsage(a: TokenUsage, b: Partial<TokenUsage>): TokenUsage {
  return {
    inputTokens: a.inputTokens + (b.inputTokens ?? 0),
    outputTokens: a.outputTokens + (b.outputTokens ?? 0),
    cacheReadTokens: (a.cacheReadTokens ?? 0) + (b.cacheReadTokens ?? 0),
    cacheWriteTokens: (a.cacheWriteTokens ?? 0) + (b.cacheWriteTokens ?? 0),
  };
}

export const EMPTY_TOKEN_USAGE: TokenUsage = { inputTokens: 0, outputTokens: 0 };

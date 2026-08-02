import type { Env } from "../env.js";
import { createGeminiClient } from "./gemini.js";
import { createAnthropicClient, type LlmClient } from "./llm.js";

/**
 * Provider selection for the agent LLM (ADR-0009). Env-driven: `LLM_PROVIDER`
 * chooses the backend, and only that provider's key is required — so a
 * free-tier Gemini setup runs with no Anthropic key. Anthropic remains fully
 * supported; this only adds a second option. Returns the resolved model so it
 * flows through to cost accounting and metrics.
 */

const DEFAULT_MODEL: Record<Env["LLM_PROVIDER"], string> = {
  anthropic: "claude-haiku-4-5-20251001",
  // The "-latest" alias is what carries free-tier quota; the pinned 2.0-flash
  // models return a hard "free_tier_requests, limit: 0" (ADR-0009).
  gemini: "gemini-flash-lite-latest",
};

export interface ResolvedLlm {
  client: LlmClient;
  provider: Env["LLM_PROVIDER"];
  model: string;
}

export function createLlmClient(env: Env): ResolvedLlm {
  const provider = env.LLM_PROVIDER;
  const model = env.AGENT_MODEL ?? DEFAULT_MODEL[provider];

  if (provider === "gemini") {
    if (!env.GEMINI_API_KEY) {
      throw new Error("LLM_PROVIDER=gemini requires GEMINI_API_KEY to be set");
    }
    return { client: createGeminiClient({ apiKey: env.GEMINI_API_KEY, model }), provider, model };
  }

  if (!env.ANTHROPIC_API_KEY) {
    throw new Error("LLM_PROVIDER=anthropic requires ANTHROPIC_API_KEY to be set");
  }
  return { client: createAnthropicClient({ apiKey: env.ANTHROPIC_API_KEY, model }), provider, model };
}

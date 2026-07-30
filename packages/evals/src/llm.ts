import Anthropic from "@anthropic-ai/sdk";
import { buildAnthropicTools } from "@vaanidesk/agent";
import type { TokenUsage } from "@vaanidesk/core";

/**
 * Non-streaming LLM turn for the harness (latency is not under test here —
 * behavior is). Same tool definitions and system prompt as production; the
 * system prompt is cache_control'd so a 30-scenario run reuses the cached
 * prefix across turns of each scenario.
 */

export type EvalLlmMessage = Anthropic.MessageParam;

export interface EvalLlmResponse {
  content: Anthropic.ContentBlock[];
  stopReason: string | null;
  usage: TokenUsage;
}

export interface EvalLlm {
  complete(args: { system: string; messages: EvalLlmMessage[] }): Promise<EvalLlmResponse>;
}

export function createEvalLlm(config: { apiKey: string; model: string }): EvalLlm {
  const client = new Anthropic({ apiKey: config.apiKey });
  const tools = buildAnthropicTools() as unknown as Anthropic.Tool[];

  return {
    async complete({ system, messages }) {
      const message = await client.messages.create({
        model: config.model,
        max_tokens: 1024,
        temperature: 0, // determinism over flair — eval reproducibility
        system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
        tools,
        messages,
      });
      return {
        content: message.content,
        stopReason: message.stop_reason,
        usage: {
          inputTokens: message.usage.input_tokens,
          outputTokens: message.usage.output_tokens,
          ...(message.usage.cache_read_input_tokens != null
            ? { cacheReadTokens: message.usage.cache_read_input_tokens }
            : {}),
          ...(message.usage.cache_creation_input_tokens != null
            ? { cacheWriteTokens: message.usage.cache_creation_input_tokens }
            : {}),
        },
      };
    },
  };
}

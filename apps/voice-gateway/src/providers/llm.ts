import Anthropic from "@anthropic-ai/sdk";
import { buildAnthropicTools } from "@vaanidesk/agent";
import type { TokenUsage } from "@vaanidesk/core";

/**
 * Streaming LLM turn runner. The session builds message history; this runs one
 * streamed request with the agent's tool definitions and reports text deltas
 * as they arrive (feeding the sentence chunker). Tool execution happens in the
 * session — this layer is transport only.
 */

export type LlmMessage = Anthropic.MessageParam;
export type LlmContentBlock = Anthropic.ContentBlock;

export interface LlmToolUse {
  id: string;
  name: string;
  input: unknown;
}

export interface LlmStreamCallbacks {
  /** First streamed content of any kind — TTFT stamp. */
  onFirstToken?: () => void;
  onTextDelta: (delta: string) => void;
}

export interface LlmTurnResult {
  /** Full concatenated assistant text of this round. */
  text: string;
  toolUses: LlmToolUse[];
  stopReason: string | null;
  usage: TokenUsage;
  /** Raw content blocks — appended verbatim to history for tool rounds. */
  assistantContent: LlmContentBlock[];
}

export interface LlmClient {
  streamTurn(args: {
    system: string;
    messages: LlmMessage[];
    signal: AbortSignal;
    callbacks: LlmStreamCallbacks;
  }): Promise<LlmTurnResult>;
}

export interface AnthropicConfig {
  apiKey: string;
  model: string;
  maxTokens?: number;
  temperature?: number;
}

export function createAnthropicClient(config: AnthropicConfig): LlmClient {
  const client = new Anthropic({ apiKey: config.apiKey });
  const tools = buildAnthropicTools() as unknown as Anthropic.Tool[];

  return {
    async streamTurn({ system, messages, signal, callbacks }) {
      const stream = client.messages.stream(
        {
          model: config.model,
          max_tokens: config.maxTokens ?? 1024,
          temperature: config.temperature ?? 0.4,
          // Prompt caching: the per-business system prompt is identical every
          // turn of the call — cache it to cut TTFT and input cost after turn 1.
          system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
          tools,
          messages,
        },
        { signal },
      );

      let sawFirstToken = false;
      stream.on("streamEvent", (event) => {
        if (
          !sawFirstToken &&
          (event.type === "content_block_start" || event.type === "content_block_delta")
        ) {
          sawFirstToken = true;
          callbacks.onFirstToken?.();
        }
      });
      stream.on("text", (delta) => {
        callbacks.onTextDelta(delta);
      });

      const message = await stream.finalMessage();

      const toolUses: LlmToolUse[] = [];
      let text = "";
      for (const block of message.content) {
        if (block.type === "text") text += block.text;
        else if (block.type === "tool_use") {
          toolUses.push({ id: block.id, name: block.name, input: block.input });
        }
      }

      const usage: TokenUsage = {
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
        ...(message.usage.cache_read_input_tokens != null
          ? { cacheReadTokens: message.usage.cache_read_input_tokens }
          : {}),
        ...(message.usage.cache_creation_input_tokens != null
          ? { cacheWriteTokens: message.usage.cache_creation_input_tokens }
          : {}),
      };

      return {
        text,
        toolUses,
        stopReason: message.stop_reason,
        usage,
        assistantContent: message.content,
      };
    },
  };
}

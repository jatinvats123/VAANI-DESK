import { GoogleGenAI, type Tool } from "@google/genai";
import {
  buildGeminiTools,
  classifyGeminiError,
  fromGeminiParts,
  GeminiDailyQuotaError,
  toGeminiContents,
  type AnthropicMessage,
  type GeminiPart,
} from "@vaanidesk/agent";
import type { TokenUsage } from "@vaanidesk/core";
import type { LlmClient, LlmContentBlock } from "./llm.js";

/**
 * Streaming Gemini implementation of LlmClient — a drop-in for the Anthropic
 * client (ADR-0009). All the Anthropic<->Gemini conversion lives in
 * `@vaanidesk/agent`; this layer is transport: it streams text deltas to the
 * sentence chunker and assembles the Anthropic-shaped result the session
 * expects. Free-tier aware: transient/rate-limit failures are retried with a
 * short backoff, but only before any audio has been spoken (retrying mid-
 * utterance would double-speak); daily-quota exhaustion fails clean.
 */

export interface GeminiConfig {
  apiKey: string;
  model: string;
  maxTokens?: number;
  temperature?: number;
  /** Retries before the first spoken token. Kept small — this is the voice path. */
  maxRetries?: number;
  baseRetryDelayMs?: number;
}

export function createGeminiClient(config: GeminiConfig): LlmClient {
  const ai = new GoogleGenAI({ apiKey: config.apiKey });
  const tools = buildGeminiTools() as unknown as Tool[];
  const maxRetries = config.maxRetries ?? 2;
  const baseDelay = config.baseRetryDelayMs ?? 300;

  return {
    async streamTurn({ system, messages, signal, callbacks }) {
      const contents = toGeminiContents(messages as unknown as AnthropicMessage[]);
      let attempt = 0;

      for (;;) {
        let emitted = false;
        try {
          const stream = await ai.models.generateContentStream({
            model: config.model,
            contents,
            config: {
              systemInstruction: system,
              tools,
              temperature: config.temperature ?? 0.4,
              maxOutputTokens: config.maxTokens ?? 1024,
              abortSignal: signal,
            },
          });

          const parts: GeminiPart[] = [];
          let usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
          let sawFirst = false;

          for await (const chunk of stream) {
            const chunkParts = chunk.candidates?.[0]?.content?.parts ?? [];
            for (const part of chunkParts) {
              parts.push(part as GeminiPart);
              if (typeof part.text === "string" && part.text.length > 0) {
                if (!sawFirst) {
                  sawFirst = true;
                  callbacks.onFirstToken?.();
                }
                emitted = true;
                callbacks.onTextDelta(part.text);
              } else if (part.functionCall && !sawFirst) {
                sawFirst = true;
                callbacks.onFirstToken?.();
              }
            }
            if (chunk.usageMetadata) {
              usage = {
                inputTokens: chunk.usageMetadata.promptTokenCount ?? 0,
                outputTokens: chunk.usageMetadata.candidatesTokenCount ?? 0,
              };
            }
          }

          const converted = fromGeminiParts(parts);
          return {
            text: converted.text,
            toolUses: converted.toolUses,
            stopReason: converted.stopReason,
            usage,
            assistantContent: converted.assistantContent as unknown as LlmContentBlock[],
          };
        } catch (error) {
          const kind = classifyGeminiError(error);
          if (kind === "daily_quota") {
            throw new GeminiDailyQuotaError(error instanceof Error ? error.message : undefined);
          }
          // Never retry once we've started speaking, or on fatal/exhausted attempts.
          if (emitted || kind === "fatal" || attempt >= maxRetries) throw error;
          attempt += 1;
          await sleep(Math.round(baseDelay * 2 ** (attempt - 1) * (0.5 + Math.random() * 0.5)), signal);
        }
      }
    },
  };
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(abortError(signal));
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(abortError(signal));
      },
      { once: true },
    );
  });
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error("aborted");
}

import { FunctionCallingConfigMode, GoogleGenAI, type Content, type Part, type Tool } from "@google/genai";
import {
  buildGeminiTools,
  callWithGeminiRetry,
  fromGeminiParts,
  toGeminiContents,
  type AnthropicMessage,
  type GeminiPart,
} from "@vaanidesk/agent";
import type { TokenUsage } from "@vaanidesk/core";
import { buildJudgeUserMessage, parseVerdict, RUBRIC, SUBMIT_VERDICT_TOOL } from "./judge.js";
import type { EvalLlm, EvalLlmResponse } from "./llm.js";
import type { ConversationResult, EvalScenario, JudgeVerdict } from "./types.js";

/**
 * Gemini backends for the eval harness — the non-latency-critical siblings of
 * the gateway's streaming client. Same Anthropic<->Gemini conversion from
 * `@vaanidesk/agent`, so scenarios and assertions are provider-blind. Retries
 * are generous here (throughput over latency) to ride out free-tier per-minute
 * limits; daily-quota exhaustion still fails clean.
 */

const RETRY = { retries: 5, baseDelayMs: 2_000, maxDelayMs: 30_000 };

function partsOf(content?: Content): Part[] {
  return content?.parts ?? [];
}

export function createGeminiEvalLlm(config: { apiKey: string; model: string }): EvalLlm {
  const ai = new GoogleGenAI({ apiKey: config.apiKey });
  const tools = buildGeminiTools() as unknown as Tool[];

  return {
    async complete({ system, messages }): Promise<EvalLlmResponse> {
      const contents = toGeminiContents(messages as unknown as AnthropicMessage[]);
      const response = await callWithGeminiRetry(
        () =>
          ai.models.generateContent({
            model: config.model,
            contents,
            config: {
              systemInstruction: system,
              tools,
              temperature: 0, // determinism for eval reproducibility
              maxOutputTokens: 1024,
            },
          }),
        RETRY,
      );

      const parts = partsOf(response.candidates?.[0]?.content) as GeminiPart[];
      const converted = fromGeminiParts(parts);
      const usage: TokenUsage = {
        inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
      };
      return {
        content: converted.assistantContent as unknown as EvalLlmResponse["content"],
        stopReason: converted.stopReason,
        usage,
      };
    },
  };
}

export async function judgeWithGemini(
  config: { apiKey: string; model: string },
  scenario: EvalScenario,
  result: ConversationResult,
): Promise<JudgeVerdict> {
  const ai = new GoogleGenAI({ apiKey: config.apiKey });

  const response = await callWithGeminiRetry(
    () =>
      ai.models.generateContent({
        model: config.model,
        contents: [{ role: "user", parts: [{ text: buildJudgeUserMessage(scenario, result) }] }],
        config: {
          systemInstruction: RUBRIC,
          temperature: 0,
          maxOutputTokens: 700,
          tools: [{ functionDeclarations: [SUBMIT_VERDICT_TOOL] }] as unknown as Tool[],
          // Force the verdict tool call — no free-text JSON to scrape.
          toolConfig: {
            functionCallingConfig: {
              mode: FunctionCallingConfigMode.ANY,
              allowedFunctionNames: [SUBMIT_VERDICT_TOOL.name],
            },
          },
        },
      }),
    RETRY,
  );

  const call = response.candidates?.[0]?.content?.parts?.find((p) => p.functionCall)?.functionCall;
  return parseVerdict(call?.args);
}

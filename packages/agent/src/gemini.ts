import { buildAnthropicTools } from "./tools.js";

/**
 * Provider-agnostic bridge: the whole system speaks Anthropic message/content-
 * block shapes (the session builds history that way, ADR-0008). To run the same
 * agent on Gemini without rewriting any of that, this module converts between
 * the Anthropic shapes and Gemini's `Content`/`Part` shapes, and adapts the
 * tool JSON Schema. Pure and SDK-free so it is unit-testable and so `@vaanidesk/
 * agent` stays free of the Google SDK — the streaming/non-streaming clients that
 * import `@google/genai` live in the gateway and evals and call into here.
 */

// ── Anthropic side (only the block shapes the session actually produces) ──────
export type AnthropicBlock =
  | { type: "text"; text: string }
  // `thoughtSignature` is Gemini-only: thinking models return it on a functionCall
  // and require it echoed back on later turns. We stash it on the (otherwise
  // Anthropic-shaped) tool_use block so it survives the round-trip through history.
  | { type: "tool_use"; id: string; name: string; input: unknown; thoughtSignature?: string }
  | { type: "tool_result"; tool_use_id: string; content: string };

export interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | AnthropicBlock[];
}

// ── Gemini side (structural — matches @google/genai without importing it) ─────
export interface GeminiPart {
  text?: string;
  functionCall?: { name: string; args: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
  /** Opaque token thinking models attach to functionCall parts; must round-trip. */
  thoughtSignature?: string;
}
export interface GeminiContent {
  role: "user" | "model";
  parts: GeminiPart[];
}
export interface GeminiFunctionDeclaration {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** JSON Schema (draft-7, from zod) keys Gemini's schema subset understands. */
const GEMINI_SCHEMA_KEYS = new Set([
  "type",
  "description",
  "enum",
  "items",
  "properties",
  "required",
  "format",
  "nullable",
]);

const TYPE_MAP: Record<string, string> = {
  object: "OBJECT",
  array: "ARRAY",
  string: "STRING",
  number: "NUMBER",
  integer: "INTEGER",
  boolean: "BOOLEAN",
};

/**
 * Reduce a draft-7 JSON Schema to Gemini's OpenAPI-subset schema: uppercase
 * types, drop validation keywords Gemini rejects (`$schema`, `additionalProperties`,
 * `minLength`, …). Recurses into properties and array items.
 */
export function jsonSchemaToGeminiSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (!GEMINI_SCHEMA_KEYS.has(key)) continue;
    if (key === "type" && typeof value === "string") {
      out.type = TYPE_MAP[value] ?? value.toUpperCase();
    } else if (key === "properties" && value && typeof value === "object") {
      out.properties = Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([prop, sub]) => [
          prop,
          jsonSchemaToGeminiSchema(sub as Record<string, unknown>),
        ]),
      );
    } else if (key === "items" && value && typeof value === "object") {
      out.items = jsonSchemaToGeminiSchema(value as Record<string, unknown>);
    } else {
      out[key] = value;
    }
  }
  return out;
}

/** The agent's tools as a single Gemini `Tool` (one functionDeclarations list). */
export function buildGeminiTools(): Array<{ functionDeclarations: GeminiFunctionDeclaration[] }> {
  const functionDeclarations = buildAnthropicTools().map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: jsonSchemaToGeminiSchema(tool.input_schema),
  }));
  return [{ functionDeclarations }];
}

function tryParseObject(text: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* not JSON — wrap below */
  }
  return { result: text };
}

/**
 * Convert Anthropic message history into Gemini `contents`. Maps roles
 * (assistant→model), text blocks to text parts, tool_use to functionCall, and
 * tool_result to functionResponse — resolving the function name from the
 * matching tool_use id (Gemini keys responses by name, Anthropic by id).
 */
export function toGeminiContents(messages: AnthropicMessage[]): GeminiContent[] {
  // id → tool name, gathered from every assistant tool_use in the history.
  const toolNameById = new Map<string, string>();
  for (const message of messages) {
    if (Array.isArray(message.content)) {
      for (const block of message.content) {
        if (block.type === "tool_use") toolNameById.set(block.id, block.name);
      }
    }
  }

  const contents: GeminiContent[] = [];
  for (const message of messages) {
    const role = message.role === "assistant" ? "model" : "user";
    if (typeof message.content === "string") {
      contents.push({ role, parts: [{ text: message.content }] });
      continue;
    }
    const parts: GeminiPart[] = [];
    for (const block of message.content) {
      if (block.type === "text") {
        parts.push({ text: block.text });
      } else if (block.type === "tool_use") {
        parts.push({
          functionCall: {
            name: block.name,
            args: (block.input ?? {}) as Record<string, unknown>,
          },
          // Echo the signature back or the model rejects the follow-up turn.
          ...(block.thoughtSignature !== undefined
            ? { thoughtSignature: block.thoughtSignature }
            : {}),
        });
      } else {
        parts.push({
          functionResponse: {
            name: toolNameById.get(block.tool_use_id) ?? block.tool_use_id,
            response: tryParseObject(block.content),
          },
        });
      }
    }
    if (parts.length > 0) contents.push({ role, parts });
  }
  return contents;
}

export interface GeminiToolCall {
  id: string;
  name: string;
  input: unknown;
}

export interface ConvertedGeminiResponse {
  text: string;
  toolUses: GeminiToolCall[];
  /** Anthropic-shaped blocks for verbatim append to history. */
  assistantContent: AnthropicBlock[];
  /** "tool_use" when the model called a function, else "end_turn". */
  stopReason: "tool_use" | "end_turn";
}

let toolCallSeq = 0;
function nextToolCallId(name: string): string {
  toolCallSeq = (toolCallSeq + 1) % Number.MAX_SAFE_INTEGER;
  return `gem_${name}_${Date.now().toString(36)}_${toolCallSeq}`;
}

/**
 * Convert accumulated Gemini parts into the Anthropic-shaped result the session
 * expects. Generates a tool_use id per functionCall (Gemini doesn't supply one);
 * the session echoes it back as the tool_result id, and `toGeminiContents`
 * resolves the name from it on the next round.
 */
export function fromGeminiParts(parts: GeminiPart[]): ConvertedGeminiResponse {
  let text = "";
  const toolUses: GeminiToolCall[] = [];
  const assistantContent: AnthropicBlock[] = [];

  for (const part of parts) {
    if (typeof part.text === "string" && part.text.length > 0) {
      text += part.text;
      assistantContent.push({ type: "text", text: part.text });
    } else if (part.functionCall) {
      const id = nextToolCallId(part.functionCall.name);
      const input = part.functionCall.args ?? {};
      toolUses.push({ id, name: part.functionCall.name, input });
      assistantContent.push({
        type: "tool_use",
        id,
        name: part.functionCall.name,
        input,
        ...(part.thoughtSignature !== undefined
          ? { thoughtSignature: part.thoughtSignature }
          : {}),
      });
    }
  }

  return {
    text,
    toolUses,
    assistantContent,
    stopReason: toolUses.length > 0 ? "tool_use" : "end_turn",
  };
}

// ── Free-tier error handling ──────────────────────────────────────────────────
export type GeminiErrorKind = "rate_limit" | "daily_quota" | "transient" | "fatal";

/**
 * Classify a Gemini SDK error so callers can react:
 *  - `rate_limit`  → per-minute cap; retry after a short backoff.
 *  - `daily_quota` → free-tier daily cap exhausted; fail clean, don't retry.
 *  - `transient`   → 5xx/network; retry.
 *  - `fatal`       → auth/bad-request; surface immediately.
 */
export function classifyGeminiError(error: unknown): GeminiErrorKind {
  const status = readStatus(error);
  const message = readMessage(error).toLowerCase();

  const looksDaily = /per\s*day|perday|daily|quota.*exhaust|free[_\s-]?tier/.test(message);

  if (status === 429 || message.includes("resource_exhausted") || message.includes("rate limit")) {
    return looksDaily ? "daily_quota" : "rate_limit";
  }
  if (status !== undefined && status >= 500) return "transient";
  if (status === undefined && /network|fetch failed|econn|timeout|socket/.test(message)) {
    return "transient";
  }
  return "fatal";
}

function readStatus(error: unknown): number | undefined {
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    for (const key of ["status", "code", "statusCode"]) {
      const value = record[key];
      if (typeof value === "number" && value >= 100 && value < 600) return value;
    }
  }
  return undefined;
}

function readMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    return String(error.message);
  }
  return "";
}

export class GeminiDailyQuotaError extends Error {
  constructor(message = "Gemini free-tier daily quota exhausted") {
    super(message);
    this.name = "GeminiDailyQuotaError";
  }
}

export interface RetryOptions {
  /** Attempts after the first try (so 2 = up to 3 total calls). */
  retries: number;
  /** Base backoff in ms; grows exponentially with jitter. */
  baseDelayMs: number;
  maxDelayMs?: number;
  signal?: AbortSignal;
  onRetry?: (info: { attempt: number; delayMs: number; kind: GeminiErrorKind }) => void;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error("aborted");
}

async function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(abortError(signal));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(abortError(signal));
      },
      { once: true },
    );
  });
}

/**
 * Run a Gemini call with free-tier-aware retries. Retries `rate_limit` and
 * `transient` with exponential backoff + jitter; throws `GeminiDailyQuotaError`
 * immediately on `daily_quota`; rethrows `fatal` as-is.
 */
export async function callWithGeminiRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  const sleep = options.sleep ?? defaultSleep;
  const maxDelay = options.maxDelayMs ?? 8_000;
  let attempt = 0;

  for (;;) {
    try {
      return await fn();
    } catch (error) {
      const kind = classifyGeminiError(error);
      if (kind === "daily_quota") {
        throw new GeminiDailyQuotaError(
          error instanceof Error ? error.message : undefined,
        );
      }
      if (kind === "fatal" || attempt >= options.retries) throw error;

      const backoff = Math.min(options.baseDelayMs * 2 ** attempt, maxDelay);
      const delayMs = Math.round(backoff * (0.5 + Math.random() * 0.5)); // 50–100% jitter
      options.onRetry?.({ attempt: attempt + 1, delayMs, kind });
      attempt += 1;
      await sleep(delayMs, options.signal);
    }
  }
}

import { describe, expect, it } from "vitest";
import {
  buildGeminiTools,
  callWithGeminiRetry,
  classifyGeminiError,
  fromGeminiParts,
  GeminiDailyQuotaError,
  jsonSchemaToGeminiSchema,
  toGeminiContents,
  type AnthropicMessage,
} from "../src/gemini.js";

describe("jsonSchemaToGeminiSchema", () => {
  it("uppercases types and drops unsupported validation keywords", () => {
    const out = jsonSchemaToGeminiSchema({
      $schema: "http://json-schema.org/draft-07/schema#",
      type: "object",
      additionalProperties: false,
      required: ["name"],
      properties: {
        name: { type: "string", minLength: 1, description: "the name" },
        tags: { type: "array", items: { type: "string" } },
      },
    });
    expect(out).toEqual({
      type: "OBJECT",
      required: ["name"],
      properties: {
        name: { type: "STRING", description: "the name" },
        tags: { type: "ARRAY", items: { type: "STRING" } },
      },
    });
  });
});

describe("buildGeminiTools", () => {
  it("produces one tool with a functionDeclaration per agent tool", () => {
    const [tool] = buildGeminiTools();
    const names = tool?.functionDeclarations.map((d) => d.name);
    expect(names).toContain("check_availability");
    expect(names).toContain("create_booking");
    // parameters were adapted to Gemini's schema shape.
    const create = tool?.functionDeclarations.find((d) => d.name === "create_booking");
    expect(create?.parameters.type).toBe("OBJECT");
  });
});

describe("toGeminiContents", () => {
  it("maps roles, tool_use, and tool_result (name resolved by id)", () => {
    const messages: AnthropicMessage[] = [
      { role: "user", content: "book me a haircut" },
      {
        role: "assistant",
        content: [
          { type: "text", text: "sure" },
          { type: "tool_use", id: "t1", name: "check_availability", input: { date: "tomorrow" } },
        ],
      },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: '{"slots":[]}' }] },
    ];
    const contents = toGeminiContents(messages);

    expect(contents[0]).toEqual({ role: "user", parts: [{ text: "book me a haircut" }] });
    expect(contents[1]?.role).toBe("model");
    expect(contents[1]?.parts[1]?.functionCall).toEqual({
      name: "check_availability",
      args: { date: "tomorrow" },
    });
    // functionResponse resolves the name from the tool_use id and parses JSON.
    expect(contents[2]?.parts[0]?.functionResponse).toEqual({
      name: "check_availability",
      response: { slots: [] },
    });
  });
});

describe("fromGeminiParts", () => {
  it("collects text and marks end_turn when no tool call", () => {
    const result = fromGeminiParts([{ text: "Hello " }, { text: "there" }]);
    expect(result.text).toBe("Hello there");
    expect(result.stopReason).toBe("end_turn");
    expect(result.toolUses).toHaveLength(0);
  });

  it("emits a tool_use block with a generated id and marks tool_use", () => {
    const result = fromGeminiParts([
      { text: "checking" },
      { functionCall: { name: "create_booking", args: { serviceId: "s1" } } },
    ]);
    expect(result.stopReason).toBe("tool_use");
    expect(result.toolUses[0]?.name).toBe("create_booking");
    expect(result.toolUses[0]?.id).toMatch(/^gem_create_booking_/);
    const toolBlock = result.assistantContent.find((b) => b.type === "tool_use");
    expect(toolBlock).toMatchObject({ type: "tool_use", name: "create_booking" });
  });

  it("round-trips a thinking model's thought_signature through history", () => {
    // Model returns a functionCall carrying a signature...
    const first = fromGeminiParts([
      { functionCall: { name: "check_availability", args: {} }, thoughtSignature: "sig-abc" },
    ]);
    const toolBlock = first.assistantContent.find((b) => b.type === "tool_use");
    expect(toolBlock).toMatchObject({ thoughtSignature: "sig-abc" });

    // ...and it must reappear on the functionCall when we send history back.
    const contents = toGeminiContents([{ role: "assistant", content: first.assistantContent }]);
    expect(contents[0]?.parts[0]).toMatchObject({
      functionCall: { name: "check_availability" },
      thoughtSignature: "sig-abc",
    });
  });
});

describe("classifyGeminiError", () => {
  it("splits per-minute rate limits from daily-quota exhaustion", () => {
    expect(classifyGeminiError({ status: 429, message: "RESOURCE_EXHAUSTED" })).toBe("rate_limit");
    expect(
      classifyGeminiError({ status: 429, message: "Quota exceeded: GenerateRequestsPerDay" }),
    ).toBe("daily_quota");
  });
  it("treats 5xx/network as transient and auth/400 as fatal", () => {
    expect(classifyGeminiError({ status: 503 })).toBe("transient");
    expect(classifyGeminiError({ message: "fetch failed" })).toBe("transient");
    expect(classifyGeminiError({ status: 401, message: "API key invalid" })).toBe("fatal");
  });
});

describe("callWithGeminiRetry", () => {
  const noSleep = () => Promise.resolve();
  // Mimics an @google/genai ApiError: an Error carrying an HTTP status.
  const apiError = (status: number, message: string): Error =>
    Object.assign(new Error(message), { status });

  it("retries rate limits then succeeds", async () => {
    let calls = 0;
    const result = await callWithGeminiRetry(
      () => {
        calls += 1;
        if (calls < 3) return Promise.reject(apiError(429, "RESOURCE_EXHAUSTED"));
        return Promise.resolve("ok");
      },
      { retries: 3, baseDelayMs: 1, sleep: noSleep },
    );
    expect(result).toBe("ok");
    expect(calls).toBe(3);
  });

  it("fails clean on daily quota without retrying", async () => {
    let calls = 0;
    await expect(
      callWithGeminiRetry(
        () => {
          calls += 1;
          return Promise.reject(apiError(429, "GenerateRequestsPerDay exceeded"));
        },
        { retries: 5, baseDelayMs: 1, sleep: noSleep },
      ),
    ).rejects.toBeInstanceOf(GeminiDailyQuotaError);
    expect(calls).toBe(1);
  });

  it("does not retry fatal errors", async () => {
    let calls = 0;
    await expect(
      callWithGeminiRetry(
        () => {
          calls += 1;
          return Promise.reject(apiError(400, "bad request"));
        },
        { retries: 5, baseDelayMs: 1, sleep: noSleep },
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(calls).toBe(1);
  });
});

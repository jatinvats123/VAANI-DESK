import { describe, expect, it } from "vitest";
import {
  addTokenUsage,
  computeLlmCostPaise,
  DEFAULT_MODEL_PRICING,
  EMPTY_TOKEN_USAGE,
  pricingForModel,
} from "../src/cost.js";
import { detectLanguageHint, dominantLanguage } from "../src/language.js";

describe("computeLlmCostPaise", () => {
  const haiku = DEFAULT_MODEL_PRICING["claude-haiku-4-5"]!;

  it("computes input+output cost and rounds up", () => {
    // 100k in @9000/MTok = 900, 10k out @45000/MTok = 450 → 1350 paise
    expect(computeLlmCostPaise({ inputTokens: 100_000, outputTokens: 10_000 }, haiku)).toBe(1350);
    // Tiny usage still costs at least 1 paisa — never rounds to free.
    expect(computeLlmCostPaise({ inputTokens: 10, outputTokens: 5 }, haiku)).toBe(1);
  });

  it("prices cache reads at the discounted default", () => {
    const withCache = computeLlmCostPaise(
      { inputTokens: 0, outputTokens: 0, cacheReadTokens: 1_000_000 },
      haiku,
    );
    expect(withCache).toBe(900); // 10% of input rate
  });

  it("resolves pricing with overrides winning", () => {
    expect(pricingForModel("claude-haiku-4-5")).toBe(haiku);
    const custom = { inputPaisePerMTok: 1, outputPaisePerMTok: 2 };
    expect(pricingForModel("claude-haiku-4-5", { "claude-haiku-4-5": custom })).toBe(custom);
    expect(pricingForModel("unknown-model")).toBeUndefined();
  });

  it("accumulates usage across turns", () => {
    const total = addTokenUsage(
      addTokenUsage(EMPTY_TOKEN_USAGE, { inputTokens: 1000, outputTokens: 50 }),
      { inputTokens: 2000, outputTokens: 100, cacheReadTokens: 500 },
    );
    expect(total).toEqual({
      inputTokens: 3000,
      outputTokens: 150,
      cacheReadTokens: 500,
      cacheWriteTokens: 0,
    });
  });
});

describe("language detection", () => {
  it("detects Devanagari as hindi", () => {
    expect(detectLanguageHint("कल शाम को हेयरकट चाहिए")).toBe("hindi");
  });

  it("detects romanized Hindi mixed with English as hinglish", () => {
    expect(detectLanguageHint("kal shaam ko haircut milega kya")).toBe("hinglish");
    expect(detectLanguageHint("haan theek hai, book kar do")).toBe("hinglish");
  });

  it("detects plain English", () => {
    expect(detectLanguageHint("Do you have a slot tomorrow evening?")).toBe("english");
    expect(detectLanguageHint("")).toBe("english");
  });

  it("picks the dominant language across turns", () => {
    expect(dominantLanguage(["kal shaam milega kya", "haan theek hai", "Yes please"])).toBe(
      "hinglish",
    );
    expect(dominantLanguage(["Hello", "One haircut please"])).toBe("english");
    expect(dominantLanguage([])).toBe("english");
  });
});

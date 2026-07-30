import { describe, expect, it } from "vitest";
import { zonedTimeToUtcMs } from "@vaanidesk/shared";
import { assembleSystemPrompt, buildGreeting, type AssemblePromptArgs } from "../src/prompt.js";

const IST = "Asia/Kolkata";

function baseArgs(): AssemblePromptArgs {
  return {
    business: {
      name: "Glow Salon Andheri",
      timezone: IST,
      hours: {
        weekly: {
          mon: [{ open: "10:00", close: "20:00" }],
          tue: [{ open: "10:00", close: "20:00" }],
          wed: [{ open: "10:00", close: "20:00" }],
          thu: [{ open: "10:00", close: "20:00" }],
          fri: [{ open: "10:00", close: "20:00" }],
          sat: [{ open: "09:00", close: "21:00" }],
          sun: [],
        },
        exceptions: [{ date: "2026-07-25", intervals: [], reason: "Maintenance" }],
      },
      promptConfig: {
        primaryLanguage: "hinglish",
        faqs: [{ question: "Parking?", answer: "Street parking on Veera Desai Road." }],
        customInstructions: "Regulars ask for Rekha didi.",
      },
      policy: { minNoticeMin: 60, maxAdvanceDays: 30 },
    },
    services: [
      {
        id: "11111111-1111-4111-8111-111111111111",
        name: "Haircut",
        durationMin: 30,
        priceDisplay: "₹400",
      },
      {
        id: "22222222-2222-4222-8222-222222222222",
        name: "Hair Colour",
        durationMin: 90,
        priceDisplay: "₹2,500",
        description: "Ammonia-free",
      },
    ],
    callerPhone: "+919876543210",
    // Friday 2026-07-17 14:00 IST
    nowUtcMs: zonedTimeToUtcMs("2026-07-17", 14 * 60, IST),
  };
}

describe("assembleSystemPrompt", () => {
  it("includes every database fact the agent may speak", () => {
    const prompt = assembleSystemPrompt(baseArgs());
    expect(prompt).toContain("Glow Salon Andheri");
    expect(prompt).toContain("₹400");
    expect(prompt).toContain("₹2,500");
    expect(prompt).toContain("[service_id: 11111111-1111-4111-8111-111111111111]");
    expect(prompt).toContain("Mon: 10:00-20:00");
    expect(prompt).toContain("Sun: closed");
    expect(prompt).toContain("Ammonia-free");
  });

  it("anchors relative dates in business-local time", () => {
    const prompt = assembleSystemPrompt(baseArgs());
    expect(prompt).toContain('"aaj"/today = 2026-07-17');
    expect(prompt).toContain('"kal"/tomorrow = 2026-07-18');
    expect(prompt).toContain("14:00 on Fri 2026-07-17");
  });

  it("surfaces upcoming exception closures inside the 14-day window", () => {
    const prompt = assembleSystemPrompt(baseArgs());
    expect(prompt).toContain("Special: 2026-07-25 → closed (Maintenance)");
  });

  it("masks the caller's phone number", () => {
    const prompt = assembleSystemPrompt(baseArgs());
    expect(prompt).not.toContain("+919876543210");
    expect(prompt).toContain("3210");
  });

  it("carries the non-negotiable guardrails and owner notes stay subordinate", () => {
    const prompt = assembleSystemPrompt(baseArgs());
    expect(prompt).toContain("NON-NEGOTIABLE RULES");
    expect(prompt).toContain("ONLY after create_booking returns success");
    expect(prompt.indexOf("NON-NEGOTIABLE RULES")).toBeLessThan(prompt.indexOf("OWNER NOTES"));
    expect(prompt).toContain("Rekha didi");
  });

  it("omits empty sections", () => {
    const args = baseArgs();
    args.business.promptConfig = { primaryLanguage: "english", faqs: [] };
    const prompt = assembleSystemPrompt(args);
    expect(prompt).not.toContain("BUSINESS FAQ");
    expect(prompt).not.toContain("OWNER NOTES");
  });

  it("is deterministic", () => {
    expect(assembleSystemPrompt(baseArgs())).toBe(assembleSystemPrompt(baseArgs()));
  });
});

describe("buildGreeting", () => {
  it("uses the owner's custom greeting verbatim when set", () => {
    const args = baseArgs();
    args.business.promptConfig = {
      ...args.business.promptConfig,
      greeting: "Custom hello!",
    };
    expect(buildGreeting(args.business)).toBe("Custom hello!");
  });

  it("always includes a recording notice in defaults", () => {
    for (const language of ["hinglish", "hindi", "english"] as const) {
      const args = baseArgs();
      args.business.promptConfig = { primaryLanguage: language, faqs: [] };
      expect(buildGreeting(args.business)).toMatch(/record|रिकॉर्ड/i);
    }
  });
});

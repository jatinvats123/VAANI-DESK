import { describe, expect, it } from "vitest";
import {
  businessHoursSchema,
  dayIntervalsSchema,
  promptConfigSchema,
} from "../src/business-config.js";

describe("dayIntervalsSchema", () => {
  it("accepts split shifts", () => {
    const result = dayIntervalsSchema.safeParse([
      { open: "09:00", close: "13:00" },
      { open: "16:00", close: "20:00" },
    ]);
    expect(result.success).toBe(true);
  });

  it("rejects overlapping intervals", () => {
    const result = dayIntervalsSchema.safeParse([
      { open: "09:00", close: "14:00" },
      { open: "13:00", close: "20:00" },
    ]);
    expect(result.success).toBe(false);
  });

  it("rejects open >= close", () => {
    expect(dayIntervalsSchema.safeParse([{ open: "18:00", close: "09:00" }]).success).toBe(false);
    expect(dayIntervalsSchema.safeParse([{ open: "09:00", close: "09:00" }]).success).toBe(false);
  });

  it("accepts back-to-back intervals (close == next open)", () => {
    const result = dayIntervalsSchema.safeParse([
      { open: "09:00", close: "13:00" },
      { open: "13:00", close: "18:00" },
    ]);
    expect(result.success).toBe(true);
  });
});

describe("businessHoursSchema", () => {
  it("accepts a full week with an exception", () => {
    const week = { open: "10:00", close: "20:00" };
    const result = businessHoursSchema.safeParse({
      weekly: {
        mon: [week],
        tue: [week],
        wed: [week],
        thu: [week],
        fri: [week],
        sat: [week],
        sun: [],
      },
      exceptions: [{ date: "2026-10-20", intervals: [], reason: "Diwali" }],
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid exception dates", () => {
    const result = businessHoursSchema.safeParse({
      weekly: { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] },
      exceptions: [{ date: "2026-02-30", intervals: [] }],
    });
    expect(result.success).toBe(false);
  });
});

describe("promptConfigSchema", () => {
  it("applies defaults", () => {
    const parsed = promptConfigSchema.parse({});
    expect(parsed.primaryLanguage).toBe("hinglish");
    expect(parsed.faqs).toEqual([]);
  });

  it("caps FAQ count", () => {
    const faqs = Array.from({ length: 51 }, (_, i) => ({
      question: `q${i}`,
      answer: `a${i}`,
    }));
    expect(promptConfigSchema.safeParse({ faqs }).success).toBe(false);
  });
});

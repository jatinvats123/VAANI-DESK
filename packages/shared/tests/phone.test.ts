import { describe, expect, it } from "vitest";
import { isE164, maskPhone, normalizePhone } from "../src/phone.js";
import { unwrapOrThrow } from "../src/result.js";

describe("normalizePhone", () => {
  it.each([
    ["9876543210", "+919876543210"],
    ["98765 43210", "+919876543210"],
    ["098765-43210", "+919876543210"],
    ["919876543210", "+919876543210"],
    ["+91 98765 43210", "+919876543210"],
    ["+91-98765-43210", "+919876543210"],
    ["(098) 765 43210", "+919876543210"],
  ])("normalizes %s → %s", (input, expected) => {
    expect(unwrapOrThrow(normalizePhone(input))).toBe(expected);
  });

  it("passes through valid non-Indian E.164 numbers", () => {
    expect(unwrapOrThrow(normalizePhone("+14155552671"))).toBe("+14155552671");
    expect(unwrapOrThrow(normalizePhone("+44 20 7946 0958"))).toBe("+442079460958");
  });

  it.each([
    [""],
    ["12345"],
    ["5876543210"], // Indian mobiles start 6-9
    ["+915876543210"],
    ["98765abc10"],
    ["+0123456789"],
  ])("rejects %s", (input) => {
    expect(normalizePhone(input).ok).toBe(false);
  });
});

describe("isE164", () => {
  it("validates", () => {
    expect(isE164("+919876543210")).toBe(true);
    expect(isE164("919876543210")).toBe(false);
    expect(isE164("+0123")).toBe(false);
  });
});

describe("maskPhone", () => {
  it("keeps prefix and last 4 digits only", () => {
    const masked = maskPhone("+919876543210");
    expect(masked.startsWith("+91")).toBe(true);
    expect(masked.endsWith("3210")).toBe(true);
    expect(masked).not.toContain("98765");
  });
});

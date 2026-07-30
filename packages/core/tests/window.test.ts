import { describe, expect, it } from "vitest";
import { zonedTimeToUtcMs, type BusinessHours } from "@vaanidesk/shared";
import { windowWithinBusinessHours } from "../src/availability/window.js";

const IST = "Asia/Kolkata";

const hours: BusinessHours = {
  weekly: {
    mon: [{ open: "10:00", close: "20:00" }],
    tue: [
      { open: "09:00", close: "13:00" },
      { open: "16:00", close: "23:59" },
    ],
    wed: [],
    thu: [{ open: "10:00", close: "20:00" }],
    fri: [{ open: "10:00", close: "20:00" }],
    sat: [{ open: "10:00", close: "20:00" }],
    sun: [],
  },
  exceptions: [{ date: "2026-07-23", intervals: [], reason: "closed" }], // a Thursday
};

function at(dateISO: string, hm: string): number {
  const [h = 0, m = 0] = hm.split(":").map(Number);
  return zonedTimeToUtcMs(dateISO, h * 60 + m, IST);
}

// 2026-07-20 is a Monday, 2026-07-22 a Wednesday, 2026-07-23 a Thursday.
describe("windowWithinBusinessHours", () => {
  it("accepts a window fully inside open hours", () => {
    expect(
      windowWithinBusinessHours(hours, IST, at("2026-07-20", "11:00"), at("2026-07-20", "11:30")),
    ).toBe(true);
  });

  it("accepts windows touching the boundaries", () => {
    expect(
      windowWithinBusinessHours(hours, IST, at("2026-07-20", "10:00"), at("2026-07-20", "10:30")),
    ).toBe(true);
    expect(
      windowWithinBusinessHours(hours, IST, at("2026-07-20", "19:30"), at("2026-07-20", "20:00")),
    ).toBe(true);
  });

  it("rejects windows outside or straddling open hours", () => {
    expect(
      windowWithinBusinessHours(hours, IST, at("2026-07-20", "09:30"), at("2026-07-20", "10:00")),
    ).toBe(false);
    expect(
      windowWithinBusinessHours(hours, IST, at("2026-07-20", "19:45"), at("2026-07-20", "20:15")),
    ).toBe(false);
    expect(
      windowWithinBusinessHours(hours, IST, at("2026-07-20", "21:00"), at("2026-07-20", "21:30")),
    ).toBe(false);
  });

  it("rejects windows spanning a split-shift break", () => {
    expect(
      windowWithinBusinessHours(hours, IST, at("2026-07-21", "12:30"), at("2026-07-21", "16:30")),
    ).toBe(false);
  });

  it("rejects closed weekdays and exception closures", () => {
    expect(
      windowWithinBusinessHours(hours, IST, at("2026-07-22", "11:00"), at("2026-07-22", "11:30")),
    ).toBe(false);
    expect(
      windowWithinBusinessHours(hours, IST, at("2026-07-23", "11:00"), at("2026-07-23", "11:30")),
    ).toBe(false);
  });

  it("rejects inverted and midnight-crossing windows", () => {
    expect(
      windowWithinBusinessHours(hours, IST, at("2026-07-20", "12:00"), at("2026-07-20", "12:00")),
    ).toBe(false);
    expect(
      windowWithinBusinessHours(hours, IST, at("2026-07-21", "23:30"), at("2026-07-22", "00:30")),
    ).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import type { BusinessHours } from "@vaanidesk/shared";
import { isOpenOn, resolveDayIntervals } from "../src/availability/schedule.js";

const hours: BusinessHours = {
  weekly: {
    mon: [{ open: "10:00", close: "20:00" }],
    tue: [{ open: "10:00", close: "20:00" }],
    wed: [
      { open: "09:00", close: "13:00" },
      { open: "16:00", close: "21:00" },
    ],
    thu: [{ open: "10:00", close: "20:00" }],
    fri: [{ open: "10:00", close: "20:00" }],
    sat: [{ open: "09:00", close: "21:00" }],
    sun: [],
  },
  exceptions: [
    { date: "2026-10-20", intervals: [], reason: "Diwali" },
    { date: "2026-07-25", intervals: [{ open: "12:00", close: "16:00" }], reason: "Half day" },
  ],
};

describe("resolveDayIntervals", () => {
  it("uses the weekly schedule by default", () => {
    // 2026-07-20 is a Monday
    expect(resolveDayIntervals(hours, "2026-07-20")).toEqual([{ startMin: 600, endMin: 1200 }]);
  });

  it("returns sorted split shifts", () => {
    // 2026-07-22 is a Wednesday
    expect(resolveDayIntervals(hours, "2026-07-22")).toEqual([
      { startMin: 540, endMin: 780 },
      { startMin: 960, endMin: 1260 },
    ]);
  });

  it("weekly closure yields no intervals", () => {
    // 2026-07-19 is a Sunday
    expect(resolveDayIntervals(hours, "2026-07-19")).toEqual([]);
  });

  it("exception closure overrides an open weekday", () => {
    // 2026-10-20 is a Tuesday, but Diwali
    expect(resolveDayIntervals(hours, "2026-10-20")).toEqual([]);
    expect(isOpenOn(hours, "2026-10-20")).toBe(false);
  });

  it("exception special hours override the weekly schedule", () => {
    // 2026-07-25 is a Saturday (normally 09:00–21:00)
    expect(resolveDayIntervals(hours, "2026-07-25")).toEqual([{ startMin: 720, endMin: 960 }]);
  });
});

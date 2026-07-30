import { describe, expect, it } from "vitest";
import { zonedTimeToUtcMs, MS_PER_MINUTE } from "@vaanidesk/shared";
import { computeDaySlots, isWindowBookable } from "../src/availability/engine.js";
import type { BusyPeriod, ComputeSlotsInput } from "../src/availability/types.js";

const IST = "Asia/Kolkata";
const DATE = "2026-07-20"; // a Monday
const dayBefore = Date.UTC(2026, 6, 19, 0, 0); // well before opening

/** UTC instant for HH:MM local on the fixture date. */
function at(hm: string): number {
  const [h, m] = hm.split(":").map(Number);
  return zonedTimeToUtcMs(DATE, h! * 60 + m!, IST);
}

function busy(startHM: string, endHM: string): BusyPeriod {
  return { startUtcMs: at(startHM), endUtcMs: at(endHM) };
}

function baseInput(overrides: Partial<ComputeSlotsInput> = {}): ComputeSlotsInput {
  return {
    dateISO: DATE,
    timeZone: IST,
    openIntervals: [{ startMin: 10 * 60, endMin: 20 * 60 }], // 10:00–20:00
    durationMin: 30,
    granularityMin: 30,
    capacity: 1,
    busy: [],
    nowUtcMs: dayBefore,
    ...overrides,
  };
}

describe("computeDaySlots — basics", () => {
  it("generates every slot for an empty day", () => {
    const slots = computeDaySlots(baseInput());
    // 10:00 through 19:30 inclusive at 30min spacing = 20 slots
    expect(slots).toHaveLength(20);
    expect(slots[0]!.startLocalHM).toBe("10:00");
    expect(slots.at(-1)!.startLocalHM).toBe("19:30");
    expect(slots[0]!.startUtcMs).toBe(at("10:00"));
    expect(slots[0]!.endUtcMs).toBe(at("10:30"));
  });

  it("never offers a slot that would run past closing", () => {
    const slots = computeDaySlots(baseInput({ durationMin: 45, granularityMin: 30 }));
    // Last valid 45min start in a 10:00–20:00 window is 19:00 (ends 19:45); 19:30 would end 20:15.
    expect(slots.at(-1)!.startLocalHM).toBe("19:00");
  });

  it("returns [] when the business is closed (no open intervals)", () => {
    expect(computeDaySlots(baseInput({ openIntervals: [] }))).toEqual([]);
  });

  it("handles split shifts with no slots in the break", () => {
    const slots = computeDaySlots(
      baseInput({
        openIntervals: [
          { startMin: 9 * 60, endMin: 13 * 60 },
          { startMin: 16 * 60, endMin: 20 * 60 },
        ],
      }),
    );
    const labels = slots.map((s) => s.startLocalHM);
    expect(labels).toContain("12:30");
    expect(labels).toContain("16:00");
    expect(labels).not.toContain("13:00");
    expect(labels).not.toContain("15:30");
  });
});

describe("computeDaySlots — conflicts and capacity", () => {
  it("removes slots overlapping an existing booking (capacity 1)", () => {
    const slots = computeDaySlots(baseInput({ busy: [busy("11:00", "12:00")] }));
    const labels = slots.map((s) => s.startLocalHM);
    expect(labels).not.toContain("11:00");
    expect(labels).not.toContain("11:30");
    expect(labels).toContain("10:30"); // ends exactly at 11:00 — no overlap (half-open)
    expect(labels).toContain("12:00"); // starts exactly at booking end
  });

  it("a partial overlap blocks the slot", () => {
    const slots = computeDaySlots(baseInput({ busy: [busy("11:15", "11:45")] }));
    const labels = slots.map((s) => s.startLocalHM);
    expect(labels).not.toContain("11:00");
    expect(labels).not.toContain("11:30");
    expect(labels).toContain("12:00");
  });

  it("capacity 2 keeps a slot open with one overlapping booking, closes it with two", () => {
    const oneBooking = computeDaySlots(baseInput({ capacity: 2, busy: [busy("11:00", "11:30")] }));
    expect(oneBooking.map((s) => s.startLocalHM)).toContain("11:00");

    const twoBookings = computeDaySlots(
      baseInput({ capacity: 2, busy: [busy("11:00", "11:30"), busy("11:00", "11:30")] }),
    );
    expect(twoBookings.map((s) => s.startLocalHM)).not.toContain("11:00");
  });

  it("enforces the buffer on both sides of a booking", () => {
    const slots = computeDaySlots(
      baseInput({ bufferMin: 15, granularityMin: 15, busy: [busy("12:00", "13:00")] }),
    );
    const labels = slots.map((s) => s.startLocalHM);
    // Before: a 30min slot must end by 11:45 to leave a 15min gap → last pre-booking start is 11:15.
    expect(labels).toContain("11:15");
    expect(labels).not.toContain("11:30");
    expect(labels).not.toContain("11:45");
    // After: first start is 13:15, not 13:00.
    expect(labels).not.toContain("13:00");
    expect(labels).toContain("13:15");
  });
});

describe("computeDaySlots — time filters", () => {
  it("filters out past slots when 'now' is mid-day", () => {
    const slots = computeDaySlots(baseInput({ nowUtcMs: at("14:10") }));
    expect(slots[0]!.startLocalHM).toBe("14:30");
  });

  it("applies minimum notice", () => {
    const slots = computeDaySlots(baseInput({ nowUtcMs: at("14:10"), minNoticeMin: 60 }));
    // Earliest allowed start is 15:10 → first candidate on the grid is 15:30.
    expect(slots[0]!.startLocalHM).toBe("15:30");
  });

  it("returns [] when the whole day is in the past", () => {
    const nextDay = at("20:00") + 60 * MS_PER_MINUTE;
    expect(computeDaySlots(baseInput({ nowUtcMs: nextDay }))).toEqual([]);
  });
});

describe("computeDaySlots — validation", () => {
  it("rejects nonsense inputs loudly", () => {
    expect(() => computeDaySlots(baseInput({ durationMin: 0 }))).toThrow();
    expect(() => computeDaySlots(baseInput({ durationMin: 12.5 }))).toThrow();
    expect(() => computeDaySlots(baseInput({ capacity: 0 }))).toThrow();
    expect(() => computeDaySlots(baseInput({ granularityMin: 0 }))).toThrow();
    expect(() =>
      computeDaySlots(baseInput({ openIntervals: [{ startMin: 600, endMin: 300 }] })),
    ).toThrow();
    expect(() =>
      computeDaySlots(baseInput({ openIntervals: [{ startMin: 0, endMin: 1441 }] })),
    ).toThrow();
  });
});

describe("isWindowBookable", () => {
  it("matches slot-generation overlap semantics", () => {
    const existing = [busy("11:00", "12:00")];
    expect(isWindowBookable(existing, at("10:30"), at("11:00"), 1)).toBe(true);
    expect(isWindowBookable(existing, at("11:30"), at("12:00"), 1)).toBe(false);
    expect(isWindowBookable(existing, at("12:00"), at("12:30"), 1)).toBe(true);
    expect(isWindowBookable(existing, at("11:30"), at("12:00"), 2)).toBe(true);
  });

  it("respects the buffer", () => {
    const existing = [busy("11:00", "12:00")];
    expect(isWindowBookable(existing, at("12:00"), at("12:30"), 1, 15)).toBe(false);
    expect(isWindowBookable(existing, at("12:15"), at("12:45"), 1, 15)).toBe(true);
  });

  it("is never bookable with capacity 0", () => {
    expect(isWindowBookable([], at("10:00"), at("10:30"), 0)).toBe(false);
  });
});

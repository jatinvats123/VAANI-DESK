import { describe, expect, it } from "vitest";
import {
  addDaysISO,
  formatMinutesAsHM,
  isValidISODate,
  parseHM,
  parseISODate,
  timeZoneOffsetMs,
  utcToLocalDateISO,
  utcToLocalMinutes,
  weekdayOfISODate,
  zonedTimeToUtcMs,
} from "../src/time.js";

const IST = "Asia/Kolkata";
const NY = "America/New_York";

describe("timeZoneOffsetMs", () => {
  it("returns +05:30 for IST at any instant (no DST)", () => {
    expect(timeZoneOffsetMs(IST, Date.UTC(2026, 0, 15))).toBe(5.5 * 3600 * 1000);
    expect(timeZoneOffsetMs(IST, Date.UTC(2026, 6, 15))).toBe(5.5 * 3600 * 1000);
  });

  it("tracks DST for America/New_York", () => {
    expect(timeZoneOffsetMs(NY, Date.UTC(2026, 0, 15))).toBe(-5 * 3600 * 1000); // EST
    expect(timeZoneOffsetMs(NY, Date.UTC(2026, 6, 15))).toBe(-4 * 3600 * 1000); // EDT
  });
});

describe("zonedTimeToUtcMs", () => {
  it("converts IST wall time to the correct UTC instant", () => {
    // 2026-07-20 17:30 IST == 2026-07-20 12:00 UTC
    const utc = zonedTimeToUtcMs("2026-07-20", 17 * 60 + 30, IST);
    expect(utc).toBe(Date.UTC(2026, 6, 20, 12, 0, 0));
  });

  it("converts IST midnight to the previous UTC evening", () => {
    const utc = zonedTimeToUtcMs("2026-07-20", 0, IST);
    expect(utc).toBe(Date.UTC(2026, 6, 19, 18, 30, 0));
  });

  it("handles US DST spring-forward gap without crashing (2026-03-08 02:30 EST does not exist)", () => {
    const utc = zonedTimeToUtcMs("2026-03-08", 2 * 60 + 30, NY);
    // Resolves to a real instant adjacent to the gap; round-trip lands on the same local date.
    expect(utcToLocalDateISO(utc, NY)).toBe("2026-03-08");
  });

  it("round-trips wall time for a normal day", () => {
    const utc = zonedTimeToUtcMs("2026-11-05", 9 * 60, IST);
    expect(utcToLocalMinutes(utc, IST)).toBe(9 * 60);
    expect(utcToLocalDateISO(utc, IST)).toBe("2026-11-05");
  });
});

describe("utcToLocalDateISO", () => {
  it("crosses the date line correctly for IST", () => {
    // 2026-07-19 20:00 UTC == 2026-07-20 01:30 IST
    expect(utcToLocalDateISO(Date.UTC(2026, 6, 19, 20, 0), IST)).toBe("2026-07-20");
  });
});

describe("ISO date helpers", () => {
  it("validates real dates only", () => {
    expect(isValidISODate("2026-02-28")).toBe(true);
    expect(isValidISODate("2026-02-30")).toBe(false);
    expect(isValidISODate("2026-13-01")).toBe(false);
    expect(isValidISODate("26-01-01")).toBe(false);
    expect(isValidISODate("2026-1-1")).toBe(false);
  });

  it("parses and adds days across month/year boundaries", () => {
    expect(parseISODate("2026-07-17")).toEqual({ year: 2026, month: 7, day: 17 });
    expect(addDaysISO("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysISO("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("computes weekdays", () => {
    expect(weekdayOfISODate("2026-07-17")).toBe("fri");
    expect(weekdayOfISODate("2026-07-19")).toBe("sun");
  });
});

describe("HH:MM helpers", () => {
  it("round-trips", () => {
    expect(parseHM("09:00")).toBe(540);
    expect(parseHM("23:59")).toBe(1439);
    expect(formatMinutesAsHM(540)).toBe("09:00");
    expect(formatMinutesAsHM(1439)).toBe("23:59");
  });

  it("rejects invalid input", () => {
    expect(() => parseHM("24:00")).toThrow();
    expect(() => parseHM("9:00")).toThrow();
    expect(() => formatMinutesAsHM(1440)).toThrow();
    expect(() => formatMinutesAsHM(-1)).toThrow();
  });
});

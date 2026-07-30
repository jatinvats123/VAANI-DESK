/**
 * Timezone utilities built on Intl — no timezone dependency. Bookings and calls
 * store UTC instants; business hours are business-local. These helpers convert
 * between the two for any IANA timezone (Asia/Kolkata today, anything later).
 */

export interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number; // 0-23
  minute: number;
  second: number;
}

const dtfCache = new Map<string, Intl.DateTimeFormat>();

function getFormatter(timeZone: string): Intl.DateTimeFormat {
  let dtf = dtfCache.get(timeZone);
  if (!dtf) {
    // Throws RangeError for invalid IANA names — callers validate tz at input time.
    dtf = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    dtfCache.set(timeZone, dtf);
  }
  return dtf;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    getFormatter(timeZone);
    return true;
  } catch {
    return false;
  }
}

/** Wall-clock components in `timeZone` at the given UTC instant. */
export function utcToZonedParts(utcMs: number, timeZone: string): ZonedParts {
  const parts = getFormatter(timeZone).formatToParts(new Date(utcMs));
  const get = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((p) => p.type === type);
    if (!part) throw new Error(`Missing date part "${type}" for timezone ${timeZone}`);
    return Number(part.value);
  };
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

/** Offset of `timeZone` from UTC at the given instant, in ms (IST → +19800000). */
export function timeZoneOffsetMs(timeZone: string, utcMs: number): number {
  const p = utcToZonedParts(utcMs, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  // Compare at whole-second precision; formatToParts has no ms component.
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/**
 * UTC instant for a wall-clock time in `timeZone`: `dateISO` (YYYY-MM-DD) at
 * `minutesFromMidnight`. Two-pass offset resolution handles DST transitions
 * (irrelevant for Asia/Kolkata, correct for everywhere else): nonexistent local
 * times (spring-forward gap) resolve to the instant shifted by the gap.
 */
export function zonedTimeToUtcMs(
  dateISO: string,
  minutesFromMidnight: number,
  timeZone: string,
): number {
  const { year, month, day } = parseISODate(dateISO);
  const naiveUtc = Date.UTC(year, month - 1, day, 0, minutesFromMidnight, 0);
  const firstGuess = naiveUtc - timeZoneOffsetMs(timeZone, naiveUtc);
  const refinedOffset = timeZoneOffsetMs(timeZone, firstGuess);
  return naiveUtc - refinedOffset;
}

/** Local calendar date (YYYY-MM-DD) in `timeZone` for a UTC instant. */
export function utcToLocalDateISO(utcMs: number, timeZone: string): string {
  const p = utcToZonedParts(utcMs, timeZone);
  return `${p.year.toString().padStart(4, "0")}-${p.month.toString().padStart(2, "0")}-${p.day
    .toString()
    .padStart(2, "0")}`;
}

/** Minutes since local midnight in `timeZone` for a UTC instant. */
export function utcToLocalMinutes(utcMs: number, timeZone: string): number {
  const p = utcToZonedParts(utcMs, timeZone);
  return p.hour * 60 + p.minute;
}

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidISODate(value: string): boolean {
  const m = ISO_DATE_RE.exec(value);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

export function parseISODate(dateISO: string): { year: number; month: number; day: number } {
  const m = ISO_DATE_RE.exec(dateISO);
  if (!m || !isValidISODate(dateISO)) {
    throw new Error(`Invalid ISO date: "${dateISO}" (expected YYYY-MM-DD)`);
  }
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

export function addDaysISO(dateISO: string, days: number): string {
  const { year, month, day } = parseISODate(dateISO);
  const d = new Date(Date.UTC(year, month - 1, day + days));
  return `${d.getUTCFullYear().toString().padStart(4, "0")}-${(d.getUTCMonth() + 1)
    .toString()
    .padStart(2, "0")}-${d.getUTCDate().toString().padStart(2, "0")}`;
}

export const WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
export type WeekdayKey = (typeof WEEKDAY_KEYS)[number];

export function weekdayOfISODate(dateISO: string): WeekdayKey {
  const { year, month, day } = parseISODate(dateISO);
  const index = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const key = WEEKDAY_KEYS[index];
  if (!key) throw new Error(`Unreachable: invalid weekday index ${index}`);
  return key;
}

const HM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** "17:30" → 1050 minutes. */
export function parseHM(value: string): number {
  const m = HM_RE.exec(value);
  if (!m) throw new Error(`Invalid HH:MM time: "${value}"`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/** 1050 → "17:30". */
export function formatMinutesAsHM(minutes: number): string {
  if (!Number.isInteger(minutes) || minutes < 0 || minutes >= 24 * 60) {
    throw new Error(`Minutes out of range for HH:MM: ${minutes}`);
  }
  const h = Math.floor(minutes / 60);
  const min = minutes % 60;
  return `${h.toString().padStart(2, "0")}:${min.toString().padStart(2, "0")}`;
}

export const MS_PER_MINUTE = 60_000;

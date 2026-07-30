import {
  parseHM,
  utcToLocalDateISO,
  utcToLocalMinutes,
  weekdayOfISODate,
  type BusinessHours,
} from "@vaanidesk/shared";
import type { MinuteInterval } from "./types.js";

/**
 * Resolve the open intervals for one business-local date: date-specific
 * exceptions (festival closures, special hours) win over the weekly schedule.
 */
export function resolveDayIntervals(hours: BusinessHours, dateISO: string): MinuteInterval[] {
  const exception = hours.exceptions.find((e) => e.date === dateISO);
  const source = exception ? exception.intervals : hours.weekly[weekdayOfISODate(dateISO)];
  return source
    .map((interval) => ({ startMin: parseHM(interval.open), endMin: parseHM(interval.close) }))
    .sort((a, b) => a.startMin - b.startMin);
}

/** True iff the business is open at all on the given local date. */
export function isOpenOn(hours: BusinessHours, dateISO: string): boolean {
  return resolveDayIntervals(hours, dateISO).length > 0;
}

/** True iff the business is open at this exact instant (gates outbound callbacks). */
export function isOpenAtInstant(hours: BusinessHours, timeZone: string, utcMs: number): boolean {
  const date = utcToLocalDateISO(utcMs, timeZone);
  const minutes = utcToLocalMinutes(utcMs, timeZone);
  return resolveDayIntervals(hours, date).some(
    (interval) => minutes >= interval.startMin && minutes < interval.endMin,
  );
}

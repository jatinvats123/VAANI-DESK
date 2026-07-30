import {
  addDaysISO,
  utcToLocalDateISO,
  utcToLocalMinutes,
  type BusinessHours,
} from "@vaanidesk/shared";
import { resolveDayIntervals } from "./schedule.js";

/**
 * Is [startUtcMs, endUtcMs) fully inside the business's open hours? Shared by
 * booking creation and reschedule — availability generation and booking
 * validation must never disagree about what "open" means.
 *
 * A window ending exactly at local midnight counts as same-day (endMin 1440).
 * Windows that otherwise cross midnight are rejected — no MVP service spans
 * closing time into the next day.
 */
export function windowWithinBusinessHours(
  hours: BusinessHours,
  timeZone: string,
  startUtcMs: number,
  endUtcMs: number,
): boolean {
  if (endUtcMs <= startUtcMs) return false;

  const startDate = utcToLocalDateISO(startUtcMs, timeZone);
  const startMin = utcToLocalMinutes(startUtcMs, timeZone);
  const endDate = utcToLocalDateISO(endUtcMs, timeZone);

  let endMin: number;
  if (endDate === startDate) {
    endMin = utcToLocalMinutes(endUtcMs, timeZone);
  } else if (endDate === addDaysISO(startDate, 1) && utcToLocalMinutes(endUtcMs, timeZone) === 0) {
    endMin = 24 * 60;
  } else {
    return false;
  }

  return resolveDayIntervals(hours, startDate).some(
    (interval) => startMin >= interval.startMin && endMin <= interval.endMin,
  );
}

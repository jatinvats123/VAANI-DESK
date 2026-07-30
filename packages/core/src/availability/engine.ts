import {
  MS_PER_MINUTE,
  utcToLocalDateISO,
  utcToLocalMinutes,
  formatMinutesAsHM,
  zonedTimeToUtcMs,
} from "@vaanidesk/shared";
import type { BusyPeriod, ComputeSlotsInput, MinuteInterval, Slot } from "./types.js";

/**
 * The availability engine. Pure: no I/O, no clock reads, no randomness — every
 * input is explicit, so behavior is exhaustively unit-testable and identical
 * across the API, evals, and any future batch jobs.
 *
 * Capacity model: resources are an interchangeable pool of size `capacity`
 * (documented limitation: no per-resource assignment yet). A candidate slot is
 * available iff the number of busy periods overlapping it is < capacity.
 *
 * Buffer model: `bufferMin` is enforced between consecutive bookings in both
 * directions by extending each interval's end by the buffer before testing
 * overlap — a booking ending at 17:00 with a 10min buffer blocks starts before
 * 17:10, and a slot ending at 17:00 blocks existing bookings starting before 17:10.
 */
export function computeDaySlots(input: ComputeSlotsInput): Slot[] {
  const granularityMin = input.granularityMin ?? 15;
  const bufferMin = input.bufferMin ?? 0;
  const minNoticeMin = input.minNoticeMin ?? 0;

  validateInput(input, granularityMin, bufferMin, minNoticeMin);

  const durationMs = input.durationMin * MS_PER_MINUTE;
  const bufferMs = bufferMin * MS_PER_MINUTE;
  const earliestStartUtcMs = input.nowUtcMs + minNoticeMin * MS_PER_MINUTE;

  const slots: Slot[] = [];
  const seenStarts = new Set<number>();
  const sortedIntervals = [...input.openIntervals].sort((a, b) => a.startMin - b.startMin);

  for (const interval of sortedIntervals) {
    const lastStartMin = interval.endMin - input.durationMin;
    for (let startMin = interval.startMin; startMin <= lastStartMin; startMin += granularityMin) {
      const startUtcMs = zonedTimeToUtcMs(input.dateISO, startMin, input.timeZone);
      // Duration is absolute time, not wall-clock — correct across DST boundaries.
      const endUtcMs = startUtcMs + durationMs;

      if (startUtcMs < earliestStartUtcMs) continue;
      // DST spring-forward can collapse two wall times onto one instant; offer it once.
      if (seenStarts.has(startUtcMs)) continue;
      // A gap can also shift the resolved instant onto a neighboring date; drop it.
      if (utcToLocalDateISO(startUtcMs, input.timeZone) !== input.dateISO) continue;

      if (countOverlapping(input.busy, startUtcMs, endUtcMs, bufferMs) < input.capacity) {
        seenStarts.add(startUtcMs);
        slots.push({
          startUtcMs,
          endUtcMs,
          startLocalHM: formatMinutesAsHM(utcToLocalMinutes(startUtcMs, input.timeZone)),
        });
      }
    }
  }

  return slots;
}

/**
 * True iff `candidate` (a proposed booking window) conflicts with existing busy
 * periods given the pool capacity — the transactional re-check used by
 * create_booking, sharing exact overlap semantics with slot generation.
 */
export function isWindowBookable(
  busy: BusyPeriod[],
  candidateStartUtcMs: number,
  candidateEndUtcMs: number,
  capacity: number,
  bufferMin = 0,
): boolean {
  if (capacity < 1) return false;
  const bufferMs = bufferMin * MS_PER_MINUTE;
  return countOverlapping(busy, candidateStartUtcMs, candidateEndUtcMs, bufferMs) < capacity;
}

function countOverlapping(
  busy: BusyPeriod[],
  startUtcMs: number,
  endUtcMs: number,
  bufferMs: number,
): number {
  let count = 0;
  for (const period of busy) {
    // Half-open intervals, each end extended by the buffer.
    if (period.startUtcMs < endUtcMs + bufferMs && startUtcMs < period.endUtcMs + bufferMs) {
      count++;
    }
  }
  return count;
}

function validateInput(
  input: ComputeSlotsInput,
  granularityMin: number,
  bufferMin: number,
  minNoticeMin: number,
): void {
  if (!Number.isInteger(input.durationMin) || input.durationMin <= 0) {
    throw new Error(`durationMin must be a positive integer, got ${input.durationMin}`);
  }
  if (!Number.isInteger(granularityMin) || granularityMin <= 0) {
    throw new Error(`granularityMin must be a positive integer, got ${granularityMin}`);
  }
  if (!Number.isInteger(input.capacity) || input.capacity < 1) {
    throw new Error(`capacity must be >= 1, got ${input.capacity}`);
  }
  if (bufferMin < 0 || minNoticeMin < 0) {
    throw new Error("bufferMin and minNoticeMin must be >= 0");
  }
  for (const interval of input.openIntervals) {
    if (!isValidMinuteInterval(interval)) {
      throw new Error(
        `Invalid open interval [${interval.startMin}, ${interval.endMin}) — expected 0 <= start < end <= 1440`,
      );
    }
  }
}

function isValidMinuteInterval(interval: MinuteInterval): boolean {
  return (
    Number.isInteger(interval.startMin) &&
    Number.isInteger(interval.endMin) &&
    interval.startMin >= 0 &&
    interval.startMin < interval.endMin &&
    interval.endMin <= 24 * 60
  );
}

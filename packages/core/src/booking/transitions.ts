import { err, ok, type Result } from "@vaanidesk/shared";
import type { BookingStatus } from "../domain.js";

/**
 * Booking lifecycle state machine. The DAL consults this before every status
 * update — there is no code path that mutates `bookings.status` around it.
 *
 *   pending ──► confirmed ──► completed
 *      │            ├───────► no_show
 *      └────────────┴───────► cancelled
 */
const ALLOWED_TRANSITIONS: Record<BookingStatus, readonly BookingStatus[]> = {
  pending: ["confirmed", "cancelled"],
  confirmed: ["completed", "no_show", "cancelled"],
  cancelled: [],
  completed: [],
  no_show: [],
};

export function canTransitionBooking(from: BookingStatus, to: BookingStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function assertBookingTransition(
  from: BookingStatus,
  to: BookingStatus,
): Result<void, string> {
  return canTransitionBooking(from, to)
    ? ok(undefined)
    : err(`Cannot transition booking from "${from}" to "${to}"`);
}

export function isTerminalBookingStatus(status: BookingStatus): boolean {
  return ALLOWED_TRANSITIONS[status].length === 0;
}

/** Statuses that occupy capacity in the availability engine. */
export const CAPACITY_HOLDING_STATUSES: readonly BookingStatus[] = ["pending", "confirmed"];

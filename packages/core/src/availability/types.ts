/** Half-open interval in minutes from local midnight: [startMin, endMin). */
export interface MinuteInterval {
  startMin: number;
  endMin: number;
}

/** An existing booking's occupied window as UTC instants (half-open). */
export interface BusyPeriod {
  startUtcMs: number;
  endUtcMs: number;
}

/** A bookable slot the agent may offer. */
export interface Slot {
  startUtcMs: number;
  endUtcMs: number;
  /** Business-local "HH:MM" label — what the agent speaks and the UI renders. */
  startLocalHM: string;
}

export interface ComputeSlotsInput {
  /** Business-local calendar date being queried (YYYY-MM-DD). */
  dateISO: string;
  /** IANA timezone of the business (e.g. Asia/Kolkata). */
  timeZone: string;
  /** Resolved open intervals for that date (weekly schedule + exceptions applied). */
  openIntervals: MinuteInterval[];
  /** Service duration in minutes. */
  durationMin: number;
  /** Candidate slot spacing. Default 15. */
  granularityMin?: number;
  /** Required gap after every booking (cleanup/turnaround). Default 0. */
  bufferMin?: number;
  /** Number of interchangeable resources that can serve concurrently. */
  capacity: number;
  /** Existing bookings overlapping the queried window. */
  busy: BusyPeriod[];
  /** Current instant — slots in the past are never offered. */
  nowUtcMs: number;
  /** Minimum notice before a booking may start. Default 0. */
  minNoticeMin?: number;
}

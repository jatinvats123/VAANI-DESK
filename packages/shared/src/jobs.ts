import { z } from "zod";

/**
 * Async job contracts — the api enqueues, apps/workers consumes. Payloads are
 * zod-validated on both sides so a version skew between deployed services
 * degrades to a rejected job, never a crashed worker. Dependency-free: BullMQ
 * lives only in the producer/consumer implementations.
 */

/** Single notification queue; the payload discriminates the work. */
export const NOTIFICATIONS_QUEUE = "vd-notifications";

export const REMINDER_KINDS = ["24h", "2h"] as const;
export type ReminderKind = (typeof REMINDER_KINDS)[number];

export const jobPayloadSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("booking_confirmation"),
    bookingId: z.string().uuid(),
    businessId: z.string().uuid(),
  }),
  z.object({
    type: z.literal("booking_reminder"),
    bookingId: z.string().uuid(),
    businessId: z.string().uuid(),
    kind: z.enum(REMINDER_KINDS),
  }),
  z.object({
    type: z.literal("booking_cancellation"),
    bookingId: z.string().uuid(),
    businessId: z.string().uuid(),
  }),
  z.object({
    type: z.literal("recording_migration"),
    callId: z.string().uuid(),
    businessId: z.string().uuid(),
    /** Provider-hosted source (e.g. Twilio RecordingUrl) to move into our bucket. */
    sourceUrl: z.string().url(),
  }),
  z.object({
    type: z.literal("missed_call_callback"),
    /** The missed inbound call being called back. */
    callId: z.string().uuid(),
    businessId: z.string().uuid(),
  }),
]);

export type JobPayload = z.infer<typeof jobPayloadSchema>;

/** The subset that sends a WhatsApp template. */
export type NotificationJobType = Exclude<
  JobPayload["type"],
  "recording_migration" | "missed_call_callback"
>;

/**
 * Deterministic job ids: enqueueing the same logical job twice dedupes at the
 * queue (idempotent producers), and reminders can be removed by id on cancel.
 */
export function confirmationJobId(bookingId: string): string {
  return `confirm:${bookingId}`;
}

export function reminderJobId(bookingId: string, kind: ReminderKind): string {
  return `remind:${bookingId}:${kind}`;
}

export function cancellationJobId(bookingId: string): string {
  return `cancel:${bookingId}`;
}

export function recordingJobId(callId: string): string {
  return `recording:${callId}`;
}

export function callbackJobId(callId: string): string {
  return `callback:${callId}`;
}

/** Wait before calling a missed caller back — they may be redialing already. */
export const MISSED_CALL_CALLBACK_DELAY_MS = 60_000;

/** Object-storage key for a call recording — private bucket, tenant-prefixed. */
export function recordingStorageKey(businessId: string, callId: string): string {
  return `recordings/${businessId}/${callId}.wav`;
}

const REMINDER_OFFSET_MS: Record<ReminderKind, number> = {
  "24h": 24 * 60 * 60 * 1000,
  "2h": 2 * 60 * 60 * 1000,
};

/** A reminder closer than this to the booking isn't worth sending. */
const MIN_REMINDER_LEAD_MS = 5 * 60 * 1000;

/**
 * Which reminders to schedule for a booking starting at `startsAtMs`, and how
 * far in the future each fires. Bookings made inside a reminder window simply
 * skip that reminder (a booking for tomorrow morning gets no 24h reminder).
 */
export function computeReminderDelays(
  startsAtMs: number,
  nowMs: number,
): Array<{ kind: ReminderKind; delayMs: number }> {
  const out: Array<{ kind: ReminderKind; delayMs: number }> = [];
  for (const kind of REMINDER_KINDS) {
    const fireAt = startsAtMs - REMINDER_OFFSET_MS[kind];
    const delayMs = fireAt - nowMs;
    if (delayMs >= MIN_REMINDER_LEAD_MS) out.push({ kind, delayMs });
  }
  return out;
}

export interface EnqueueOptions {
  /** Deterministic id — same id while a job is queued means "already enqueued". */
  jobId: string;
  delayMs?: number;
}

/**
 * Producer port the api depends on. Contract: implementations NEVER throw —
 * queueing is best-effort beside the booking write (the DB row is the source
 * of truth; a lost notification must not fail a booking). Failures are logged
 * inside the implementation.
 */
export interface JobEnqueuer {
  enqueue(payload: JobPayload, options: EnqueueOptions): Promise<void>;
  /** Remove a queued (not yet running) job by id — used to cancel reminders. */
  remove(jobId: string): Promise<void>;
}

/** No-op enqueuer for tests and queue-less local runs. */
export const NULL_ENQUEUER: JobEnqueuer = {
  enqueue: () => Promise.resolve(),
  remove: () => Promise.resolve(),
};

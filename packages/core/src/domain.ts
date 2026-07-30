/**
 * Domain vocabulary — the single source of truth for every enum in the system.
 * The DB layer builds Postgres enums from these arrays, the API validates with
 * them, and the agent's tool schemas enumerate them. Add values here first.
 */

export const BOOKING_STATUSES = [
  "pending",
  "confirmed",
  "cancelled",
  "completed",
  "no_show",
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const BOOKING_SOURCES = ["voice", "dashboard", "whatsapp", "api"] as const;
export type BookingSource = (typeof BOOKING_SOURCES)[number];

export const CALL_DIRECTIONS = ["inbound", "outbound"] as const;
export type CallDirection = (typeof CALL_DIRECTIONS)[number];

export const CALL_STATUSES = ["ringing", "in_progress", "completed", "failed"] as const;
export type CallStatus = (typeof CALL_STATUSES)[number];

export const CALL_OUTCOMES = [
  "booking_created",
  "booking_cancelled",
  "booking_rescheduled",
  "info_provided",
  "transferred",
  "abandoned",
  "voicemail",
  "failed",
  "spam",
] as const;
export type CallOutcome = (typeof CALL_OUTCOMES)[number];

export const TURN_ROLES = ["caller", "agent", "system", "tool"] as const;
export type TurnRole = (typeof TURN_ROLES)[number];

export const MEMBERSHIP_ROLES = ["owner", "staff"] as const;
export type MembershipRole = (typeof MEMBERSHIP_ROLES)[number];

export const RESOURCE_TYPES = ["staff", "room", "equipment", "vehicle"] as const;
export type ResourceType = (typeof RESOURCE_TYPES)[number];

export const TELEPHONY_PROVIDERS = ["twilio", "exotel"] as const;
export type TelephonyProvider = (typeof TELEPHONY_PROVIDERS)[number];

export const WEBHOOK_EVENT_STATUSES = ["received", "processed", "failed", "skipped"] as const;
export type WebhookEventStatus = (typeof WEBHOOK_EVENT_STATUSES)[number];

export const EVAL_RUN_STATUSES = ["running", "completed", "failed"] as const;
export type EvalRunStatus = (typeof EVAL_RUN_STATUSES)[number];

export const EVAL_TRIGGERS = ["ci", "nightly", "manual"] as const;
export type EvalTrigger = (typeof EVAL_TRIGGERS)[number];

export const EVAL_VERDICTS = ["pass", "fail", "error"] as const;
export type EvalVerdict = (typeof EVAL_VERDICTS)[number];

export const AUDIT_ACTOR_TYPES = ["user", "agent", "system"] as const;
export type AuditActorType = (typeof AUDIT_ACTOR_TYPES)[number];

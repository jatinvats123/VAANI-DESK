import { pgEnum } from "drizzle-orm/pg-core";
import {
  AUDIT_ACTOR_TYPES,
  BOOKING_SOURCES,
  BOOKING_STATUSES,
  CALL_DIRECTIONS,
  CALL_OUTCOMES,
  CALL_STATUSES,
  EVAL_RUN_STATUSES,
  EVAL_TRIGGERS,
  EVAL_VERDICTS,
  MEMBERSHIP_ROLES,
  RESOURCE_TYPES,
  TELEPHONY_PROVIDERS,
  TURN_ROLES,
  WEBHOOK_EVENT_STATUSES,
} from "@vaanidesk/core";

// Postgres enums are generated from the domain vocabulary in @vaanidesk/core —
// adding a value there and running db:generate produces the ALTER TYPE migration.

export const bookingStatusEnum = pgEnum("booking_status", BOOKING_STATUSES);
export const bookingSourceEnum = pgEnum("booking_source", BOOKING_SOURCES);
export const callDirectionEnum = pgEnum("call_direction", CALL_DIRECTIONS);
export const callStatusEnum = pgEnum("call_status", CALL_STATUSES);
export const callOutcomeEnum = pgEnum("call_outcome", CALL_OUTCOMES);
export const turnRoleEnum = pgEnum("turn_role", TURN_ROLES);
export const membershipRoleEnum = pgEnum("membership_role", MEMBERSHIP_ROLES);
export const resourceTypeEnum = pgEnum("resource_type", RESOURCE_TYPES);
export const telephonyProviderEnum = pgEnum("telephony_provider", TELEPHONY_PROVIDERS);
export const webhookEventStatusEnum = pgEnum("webhook_event_status", WEBHOOK_EVENT_STATUSES);
export const evalRunStatusEnum = pgEnum("eval_run_status", EVAL_RUN_STATUSES);
export const evalTriggerEnum = pgEnum("eval_trigger", EVAL_TRIGGERS);
export const evalVerdictEnum = pgEnum("eval_verdict", EVAL_VERDICTS);
export const auditActorTypeEnum = pgEnum("audit_actor_type", AUDIT_ACTOR_TYPES);

import type {
  CallCostBreakdown,
  CallLatencyRollup,
  TokenUsage,
  ToolCallRecord,
  TurnMetrics,
} from "@vaanidesk/core";
import { index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { businesses } from "./businesses.js";
import {
  callDirectionEnum,
  callOutcomeEnum,
  callStatusEnum,
  telephonyProviderEnum,
  turnRoleEnum,
} from "./enums.js";

export const calls = pgTable(
  "calls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    provider: telephonyProviderEnum("provider").notNull(),
    /** Provider's call SID — status callbacks upsert against this. */
    providerCallId: text("provider_call_id").notNull(),
    direction: callDirectionEnum("direction").notNull().default("inbound"),
    status: callStatusEnum("status").notNull().default("ringing"),
    fromNumber: text("from_number").notNull(),
    toNumber: text("to_number").notNull(),
    /** Dominant language detected during the call (hi / en / hinglish). */
    language: text("language"),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
    answeredAt: timestamp("answered_at", { withTimezone: true, mode: "date" }),
    endedAt: timestamp("ended_at", { withTimezone: true, mode: "date" }),
    durationSec: integer("duration_sec"),
    outcome: callOutcomeEnum("outcome"),
    /** Object-storage key of the recording (private bucket; URLs are signed on demand). */
    recordingKey: text("recording_key"),
    /** E.164 the call was transferred to, when outcome = transferred. */
    transferredTo: text("transferred_to"),
    costBreakdown: jsonb("cost_breakdown").$type<CallCostBreakdown>(),
    totalCostPaise: integer("total_cost_paise"),
    latencyRollup: jsonb("latency_rollup").$type<CallLatencyRollup>(),
    tokenUsage: jsonb("token_usage").$type<TokenUsage>(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    unique("calls_provider_call_uq").on(t.provider, t.providerCallId),
    index("calls_business_started_idx").on(t.businessId, t.startedAt),
    index("calls_business_outcome_idx").on(t.businessId, t.outcome),
  ],
);

export const callTurns = pgTable(
  "call_turns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    callId: uuid("call_id")
      .notNull()
      .references(() => calls.id, { onDelete: "cascade" }),
    /** Denormalized for tenant-scoped queries without a join. */
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    turnIndex: integer("turn_index").notNull(),
    role: turnRoleEnum("role").notNull(),
    text: text("text"),
    toolCalls: jsonb("tool_calls").$type<ToolCallRecord[]>(),
    /** Object-storage key for this turn's audio segment, when captured. */
    audioKey: text("audio_key"),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }),
    endedAt: timestamp("ended_at", { withTimezone: true, mode: "date" }),
    metrics: jsonb("metrics").$type<TurnMetrics>(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
  },
  (t) => [
    unique("call_turns_call_index_uq").on(t.callId, t.turnIndex),
    index("call_turns_business_idx").on(t.businessId),
  ],
);

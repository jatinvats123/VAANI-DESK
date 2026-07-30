import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { businesses } from "./businesses.js";
import { auditActorTypeEnum } from "./enums.js";

/**
 * Append-only audit trail: who (user/agent/system) did what to which entity.
 * Written by the DAL alongside sensitive mutations; never updated or deleted.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id").references(() => businesses.id, { onDelete: "set null" }),
    actorType: auditActorTypeEnum("actor_type").notNull(),
    /** user id, call id (for the voice agent), or a system job name. */
    actorId: text("actor_id"),
    /** Verb-first, e.g. "booking.created", "service.price_changed". */
    action: text("action").notNull(),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
  },
  (t) => [index("audit_log_business_created_idx").on(t.businessId, t.createdAt)],
);

import { index, integer, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { businesses, resources, services } from "./businesses.js";
import { calls } from "./calls.js";
import { bookingSourceEnum, bookingStatusEnum } from "./enums.js";

export const bookings = pgTable(
  "bookings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    serviceId: uuid("service_id")
      .notNull()
      .references(() => services.id, { onDelete: "restrict" }),
    resourceId: uuid("resource_id").references(() => resources.id, { onDelete: "set null" }),
    /** The call that created this booking, when source = voice. */
    callId: uuid("call_id").references(() => calls.id, { onDelete: "set null" }),
    customerName: text("customer_name").notNull(),
    customerPhone: text("customer_phone").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true, mode: "date" }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true, mode: "date" }).notNull(),
    status: bookingStatusEnum("status").notNull().default("confirmed"),
    source: bookingSourceEnum("source").notNull(),
    /** Price snapshot at booking time — service price edits never rewrite history. */
    pricePaise: integer("price_paise").notNull(),
    notes: text("notes"),
    /**
     * Client-supplied dedupe key (voice: callSid + turn). The unique constraint
     * makes agent/network retries structurally unable to double-book.
     */
    idempotencyKey: text("idempotency_key").notNull(),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true, mode: "date" }),
    cancellationReason: text("cancellation_reason"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    unique("bookings_business_idempotency_uq").on(t.businessId, t.idempotencyKey),
    index("bookings_business_starts_idx").on(t.businessId, t.startsAt),
    index("bookings_business_status_starts_idx").on(t.businessId, t.status, t.startsAt),
    index("bookings_business_customer_idx").on(t.businessId, t.customerPhone),
  ],
);

import { index, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { webhookEventStatusEnum } from "./enums.js";

/**
 * Inbound webhook ledger. Every telephony/WhatsApp webhook is recorded here
 * first; the (provider, event_id) unique constraint makes replayed deliveries
 * no-ops. Processing happens off this ledger (directly or via queue), so a
 * crash after receipt never loses an event.
 */
export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** "twilio" | "exotel" | "whatsapp" — text on purpose; providers grow. */
    provider: text("provider").notNull(),
    /** Provider's unique delivery/event id (or a stable derived hash). */
    eventId: text("event_id").notNull(),
    eventType: text("event_type"),
    payload: jsonb("payload").notNull(),
    status: webhookEventStatusEnum("status").notNull().default("received"),
    error: text("error"),
    receivedAt: timestamp("received_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true, mode: "date" }),
  },
  (t) => [
    unique("webhook_events_provider_event_uq").on(t.provider, t.eventId),
    index("webhook_events_status_idx").on(t.status, t.receivedAt),
  ],
);

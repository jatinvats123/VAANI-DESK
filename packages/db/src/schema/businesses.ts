import type { BusinessHours, PromptConfig } from "@vaanidesk/shared";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { membershipRoleEnum, resourceTypeEnum } from "./enums.js";
import { users } from "./auth.js";

export const businesses = pgTable("businesses", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  /** Provisioned inbound line (E.164). Null until telephony provisioning completes. */
  phoneNumber: text("phone_number").unique(),
  /** Human fallback target for owner transfer (E.164). */
  ownerPhone: text("owner_phone"),
  /** Owner's WhatsApp for daily summaries / alerts (E.164). */
  notificationPhone: text("notification_phone"),
  timezone: text("timezone").notNull().default("Asia/Kolkata"),
  /** Weekly schedule + date exceptions — validated by businessHoursSchema (shared). */
  hours: jsonb("hours").$type<BusinessHours>().notNull(),
  /** Greeting, language, FAQs, custom instructions — validated by promptConfigSchema. */
  promptConfig: jsonb("prompt_config").$type<PromptConfig>().notNull(),
  // Booking policy (flat columns: queried by the availability engine on every call)
  slotGranularityMin: integer("slot_granularity_min").notNull().default(15),
  bookingBufferMin: integer("booking_buffer_min").notNull().default(0),
  minNoticeMin: integer("min_notice_min").notNull().default(60),
  maxAdvanceDays: integer("max_advance_days").notNull().default(30),
  /** Set when the onboarding wizard completes — gates going live. */
  onboardedAt: timestamp("onboarded_at", { withTimezone: true, mode: "date" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    role: membershipRoleEnum("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
  },
  (t) => [
    unique("memberships_user_business_uq").on(t.userId, t.businessId),
    index("memberships_business_idx").on(t.businessId),
  ],
);

export const services = pgTable(
  "services",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    durationMin: integer("duration_min").notNull(),
    pricePaise: integer("price_paise").notNull(),
    /** Soft-archive — bookings keep their FK, the agent stops offering it. */
    active: boolean("active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [index("services_business_idx").on(t.businessId)],
);

export const resources = pgTable(
  "resources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: resourceTypeEnum("type").notNull().default("staff"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [index("resources_business_idx").on(t.businessId)],
);

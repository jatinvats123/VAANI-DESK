import { relations } from "drizzle-orm";
import { accounts, sessions, users } from "./auth.js";
import { businesses, memberships, resources, services } from "./businesses.js";
import { bookings } from "./bookings.js";
import { calls, callTurns } from "./calls.js";
import { evalCases, evalResults, evalRuns } from "./evals.js";

export const usersRelations = relations(users, ({ many }) => ({
  memberships: many(memberships),
  accounts: many(accounts),
  sessions: many(sessions),
}));

export const businessesRelations = relations(businesses, ({ many }) => ({
  memberships: many(memberships),
  services: many(services),
  resources: many(resources),
  bookings: many(bookings),
  calls: many(calls),
}));

export const membershipsRelations = relations(memberships, ({ one }) => ({
  user: one(users, { fields: [memberships.userId], references: [users.id] }),
  business: one(businesses, { fields: [memberships.businessId], references: [businesses.id] }),
}));

export const servicesRelations = relations(services, ({ one, many }) => ({
  business: one(businesses, { fields: [services.businessId], references: [businesses.id] }),
  bookings: many(bookings),
}));

export const resourcesRelations = relations(resources, ({ one, many }) => ({
  business: one(businesses, { fields: [resources.businessId], references: [businesses.id] }),
  bookings: many(bookings),
}));

export const bookingsRelations = relations(bookings, ({ one }) => ({
  business: one(businesses, { fields: [bookings.businessId], references: [businesses.id] }),
  service: one(services, { fields: [bookings.serviceId], references: [services.id] }),
  resource: one(resources, { fields: [bookings.resourceId], references: [resources.id] }),
  call: one(calls, { fields: [bookings.callId], references: [calls.id] }),
}));

export const callsRelations = relations(calls, ({ one, many }) => ({
  business: one(businesses, { fields: [calls.businessId], references: [businesses.id] }),
  turns: many(callTurns),
  bookings: many(bookings),
}));

export const callTurnsRelations = relations(callTurns, ({ one }) => ({
  call: one(calls, { fields: [callTurns.callId], references: [calls.id] }),
}));

export const evalRunsRelations = relations(evalRuns, ({ many }) => ({
  results: many(evalResults),
}));

export const evalResultsRelations = relations(evalResults, ({ one }) => ({
  run: one(evalRuns, { fields: [evalResults.runId], references: [evalRuns.id] }),
  case: one(evalCases, { fields: [evalResults.caseId], references: [evalCases.id] }),
}));

export const evalCasesRelations = relations(evalCases, ({ many }) => ({
  results: many(evalResults),
}));

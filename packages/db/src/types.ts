import type {
  auditLog,
  bookings,
  businesses,
  calls,
  callTurns,
  evalCases,
  evalResults,
  evalRuns,
  memberships,
  resources,
  services,
  users,
  webhookEvents,
} from "./schema/index.js";

export type User = typeof users.$inferSelect;
export type Business = typeof businesses.$inferSelect;
export type NewBusiness = typeof businesses.$inferInsert;
export type Membership = typeof memberships.$inferSelect;
export type Service = typeof services.$inferSelect;
export type NewService = typeof services.$inferInsert;
export type Resource = typeof resources.$inferSelect;
export type NewResource = typeof resources.$inferInsert;
export type Booking = typeof bookings.$inferSelect;
export type NewBooking = typeof bookings.$inferInsert;
export type Call = typeof calls.$inferSelect;
export type NewCall = typeof calls.$inferInsert;
export type CallTurn = typeof callTurns.$inferSelect;
export type NewCallTurn = typeof callTurns.$inferInsert;
export type WebhookEvent = typeof webhookEvents.$inferSelect;
export type AuditLogEntry = typeof auditLog.$inferSelect;
export type EvalCase = typeof evalCases.$inferSelect;
export type EvalRun = typeof evalRuns.$inferSelect;
export type EvalResult = typeof evalResults.$inferSelect;

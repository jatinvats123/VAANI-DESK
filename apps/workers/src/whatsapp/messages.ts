import type { NotificationJobType } from "@vaanidesk/shared";

/**
 * Pure template-parameter builders. Templates are pre-approved in the WhatsApp
 * manager with positional body params — the exact texts live in Meta's
 * dashboard; this module owns only the parameter contract:
 *
 *   confirmation: {{1}} customer · {{2}} service · {{3}} when · {{4}} business · {{5}} price
 *   reminder:     {{1}} customer · {{2}} service · {{3}} when · {{4}} business
 *   cancellation: {{1}} customer · {{2}} service · {{3}} when · {{4}} business
 */

export interface BookingMessageContext {
  customerName: string;
  serviceName: string;
  /** UTC instant of the booking start. */
  startsAtMs: number;
  timezone: string;
  businessName: string;
  /** Display price, e.g. "₹400". */
  priceDisplay: string;
}

/** "Sat, 19 Jul, 5:30 pm" in the business's timezone — speakable and unambiguous. */
export function formatWhen(startsAtMs: number, timezone: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: timezone,
  }).format(new Date(startsAtMs));
}

export function buildBodyParams(type: NotificationJobType, ctx: BookingMessageContext): string[] {
  const when = formatWhen(ctx.startsAtMs, ctx.timezone);
  switch (type) {
    case "booking_confirmation":
      return [ctx.customerName, ctx.serviceName, when, ctx.businessName, ctx.priceDisplay];
    case "booking_reminder":
      return [ctx.customerName, ctx.serviceName, when, ctx.businessName];
    case "booking_cancellation":
      return [ctx.customerName, ctx.serviceName, when, ctx.businessName];
  }
}

export function templateForType(
  type: NotificationJobType,
  templates: { confirmation: string; reminder: string; cancellation: string },
): string {
  switch (type) {
    case "booking_confirmation":
      return templates.confirmation;
    case "booking_reminder":
      return templates.reminder;
    case "booking_cancellation":
      return templates.cancellation;
  }
}

import { formatINR, type JobPayload, type NotificationJobType } from "@vaanidesk/shared";
import type { Dal } from "@vaanidesk/db";
import type { Env } from "./env.js";
import type { Logger } from "./logger.js";
import type { WhatsappClient } from "./whatsapp/client.js";
import { buildBodyParams, templateForType } from "./whatsapp/messages.js";

export interface HandlerDeps {
  dal: Dal;
  whatsapp: WhatsappClient;
  env: Env;
  log: Logger;
}

/** Thrown to trigger a BullMQ retry; anything else completes the job. */
export class RetryableJobError extends Error {}

/**
 * One notification job, end to end: load current state, decide whether the
 * message still makes sense, send, audit. Idempotence: the audit trail is
 * per-job-type + booking, and BullMQ's deterministic jobIds prevent duplicate
 * enqueues — a retried job after a partial failure re-sends at most once.
 */
export async function handleNotificationJob(
  deps: HandlerDeps,
  payload: Extract<JobPayload, { type: NotificationJobType }>,
): Promise<void> {
  const { dal, whatsapp, env, log } = deps;
  const tenant = dal.forBusiness(payload.businessId);

  const booking = await tenant.bookings.getById(payload.bookingId);
  if (!booking) {
    log.warn({ bookingId: payload.bookingId }, "job for unknown booking — dropping");
    return;
  }
  const [business, service] = await Promise.all([
    tenant.business.get(),
    tenant.services.getById(booking.serviceId),
  ]);

  // A cancelled/completed booking must never get a confirmation or reminder.
  const stillRelevant =
    payload.type === "booking_cancellation"
      ? booking.status === "cancelled"
      : booking.status === "confirmed" || booking.status === "pending";
  if (!stillRelevant) {
    log.info(
      { bookingId: booking.id, status: booking.status, type: payload.type },
      "booking state changed — skipping notification",
    );
    return;
  }
  // Reminders for a booking that already started are noise.
  if (payload.type === "booking_reminder" && booking.startsAt.getTime() <= Date.now()) {
    return;
  }

  const outcome = await whatsapp.sendTemplate({
    to: booking.customerPhone,
    templateName: templateForType(payload.type, {
      confirmation: env.WHATSAPP_TEMPLATE_CONFIRMATION,
      reminder: env.WHATSAPP_TEMPLATE_REMINDER,
      cancellation: env.WHATSAPP_TEMPLATE_CANCELLATION,
    }),
    languageCode: env.WHATSAPP_TEMPLATE_LANGUAGE,
    bodyParams: buildBodyParams(payload.type, {
      customerName: booking.customerName,
      serviceName: service?.name ?? "your appointment",
      startsAtMs: booking.startsAt.getTime(),
      timezone: business.timezone,
      businessName: business.name,
      priceDisplay: formatINR(booking.pricePaise),
    }),
  });

  if (outcome.ok) {
    await tenant.audit.record({
      actorType: "system",
      actorId: "workers",
      action: `whatsapp.${payload.type}.sent`,
      entityType: "booking",
      entityId: booking.id,
      metadata: { messageId: outcome.messageId ?? null },
    });
    log.info({ bookingId: booking.id, type: payload.type }, "whatsapp notification sent");
    return;
  }

  if (outcome.retryable) {
    throw new RetryableJobError(outcome.error);
  }
  // Permanent failure (or unconfigured creds): audit and complete the job.
  await tenant.audit.record({
    actorType: "system",
    actorId: "workers",
    action: `whatsapp.${payload.type}.skipped`,
    entityType: "booking",
    entityId: booking.id,
    metadata: { reason: outcome.error },
  });
  log.warn({ bookingId: booking.id, reason: outcome.error }, "whatsapp notification skipped");
}

import {
  isWindowBookable,
  windowWithinBusinessHours,
  type AuditActorType,
  type BookingSource,
} from "@vaanidesk/core";
import {
  addDaysISO,
  AppError,
  cancellationJobId,
  computeReminderDelays,
  confirmationJobId,
  err,
  formatMinutesAsHM,
  MS_PER_MINUTE,
  normalizePhone,
  ok,
  REMINDER_KINDS,
  reminderJobId,
  utcToLocalDateISO,
  utcToLocalMinutes,
  type JobEnqueuer,
  type Result,
} from "@vaanidesk/shared";
import type { Booking, Business, Service, TenantDal } from "@vaanidesk/db";
import { computeSlotsForDate, nearestSlots } from "../availability/service.js";

export interface BookingActor {
  type: AuditActorType;
  /** user id for dashboard actions, call id for the voice agent. */
  id?: string;
}

export interface BookingDeps {
  tenant: TenantDal;
  business: Business;
  actor: BookingActor;
  /** Notification producer — absent in tests; contract: never throws. */
  jobs?: JobEnqueuer;
  now?: () => Date;
}

export interface CreateBookingRequest {
  serviceId: string;
  startsAt: Date;
  customerName: string;
  customerPhone: string;
  source: BookingSource;
  idempotencyKey: string;
  callId?: string | null;
  notes?: string | null;
}

export interface SlotAlternative {
  startsAt: string;
  label: string;
}

/**
 * The write-side invariant everything else leans on: a booking row exists only
 * if — inside one transaction holding the per-business advisory lock — the
 * window was inside business hours, satisfied notice/advance policy, and the
 * capacity re-check passed. `slot_unavailable` errors carry nearby open slots
 * so the agent can immediately re-negotiate instead of dead-ending.
 */
export async function createBooking(
  deps: BookingDeps,
  request: CreateBookingRequest,
): Promise<Result<{ booking: Booking; created: boolean }, AppError>> {
  const { tenant, business } = deps;
  const now = deps.now?.() ?? new Date();

  const service = await tenant.services.getById(request.serviceId);
  if (!service || !service.active) {
    return err(AppError.notFound("Service", request.serviceId));
  }

  const phone = normalizePhone(request.customerPhone);
  if (!phone.ok) return err(AppError.validation(phone.error));

  const startsAt = request.startsAt;
  const endsAt = new Date(startsAt.getTime() + service.durationMin * MS_PER_MINUTE);

  const policyCheck = await validateWindowAgainstPolicy(deps, service, startsAt, endsAt, now);
  if (!policyCheck.ok) return policyCheck;

  const outcome = await tenant.transaction(async (tx) => {
    await tx.acquireBookingWriteLock();

    // Idempotency replay: if this key already booked, return that booking without
    // re-running availability (the slot is legitimately held by this same booking).
    const replay = await tx.bookings.findByIdempotencyKey(request.idempotencyKey);
    if (replay) return { booking: replay, created: false } as const;

    const bufferMs = business.bookingBufferMin * MS_PER_MINUTE;
    const busy = await tx.bookings.listCapacityHolding(
      new Date(startsAt.getTime() - bufferMs),
      new Date(endsAt.getTime() + bufferMs),
    );
    const capacity = Math.max(1, await tx.resources.activeCount());
    if (
      !isWindowBookable(
        busy,
        startsAt.getTime(),
        endsAt.getTime(),
        capacity,
        business.bookingBufferMin,
      )
    ) {
      return "conflict" as const;
    }

    const result = await tx.bookings.createIdempotent({
      serviceId: service.id,
      callId: request.callId ?? null,
      customerName: request.customerName.trim(),
      customerPhone: phone.value,
      startsAt,
      endsAt,
      source: request.source,
      pricePaise: service.pricePaise,
      notes: request.notes ?? null,
      idempotencyKey: request.idempotencyKey,
    });

    if (result.created) {
      await tx.audit.record({
        actorType: deps.actor.type,
        actorId: deps.actor.id,
        action: "booking.created",
        entityType: "booking",
        entityId: result.booking.id,
        metadata: {
          source: request.source,
          serviceId: service.id,
          startsAt: startsAt.toISOString(),
        },
      });
    }
    return result;
  });

  if (outcome === "conflict") {
    return err(
      AppError.slotUnavailable("That slot was just taken", {
        alternatives: await alternativesNear(deps, service, startsAt, now),
      }),
    );
  }

  if (outcome.created && deps.jobs) {
    const booking = outcome.booking;
    await deps.jobs.enqueue(
      { type: "booking_confirmation", bookingId: booking.id, businessId: business.id },
      { jobId: confirmationJobId(booking.id) },
    );
    for (const { kind, delayMs } of computeReminderDelays(
      booking.startsAt.getTime(),
      now.getTime(),
    )) {
      await deps.jobs.enqueue(
        { type: "booking_reminder", bookingId: booking.id, businessId: business.id, kind },
        { jobId: reminderJobId(booking.id, kind), delayMs },
      );
    }
  }
  return ok(outcome);
}

export async function cancelBooking(
  deps: BookingDeps,
  bookingId: string,
  reason?: string,
): Promise<Result<Booking, AppError>> {
  const result = await deps.tenant.bookings.transitionStatus(bookingId, "cancelled", {
    ...(reason !== undefined ? { reason } : {}),
  });
  if (result.ok) {
    await deps.tenant.audit.record({
      actorType: deps.actor.type,
      actorId: deps.actor.id,
      action: "booking.cancelled",
      entityType: "booking",
      entityId: bookingId,
      metadata: reason !== undefined ? { reason } : {},
    });
    if (deps.jobs) {
      // Pending reminders are pointless now; the handler also re-checks status.
      for (const kind of REMINDER_KINDS) {
        await deps.jobs.remove(reminderJobId(bookingId, kind));
      }
      await deps.jobs.enqueue(
        { type: "booking_cancellation", bookingId, businessId: deps.business.id },
        { jobId: cancellationJobId(bookingId) },
      );
    }
  }
  return result;
}

export async function rescheduleBooking(
  deps: BookingDeps,
  bookingId: string,
  newStartsAt: Date,
): Promise<Result<Booking, AppError>> {
  const { tenant, business } = deps;
  const now = deps.now?.() ?? new Date();

  const existing = await tenant.bookings.getById(bookingId);
  if (!existing) return err(AppError.notFound("Booking", bookingId));
  if (existing.status !== "confirmed" && existing.status !== "pending") {
    return err(AppError.conflict(`Cannot reschedule a ${existing.status} booking`));
  }

  const service = await tenant.services.getById(existing.serviceId);
  if (!service) return err(AppError.internal("Booking references a missing service"));

  const newEndsAt = new Date(newStartsAt.getTime() + service.durationMin * MS_PER_MINUTE);
  const policyCheck = await validateWindowAgainstPolicy(deps, service, newStartsAt, newEndsAt, now);
  if (!policyCheck.ok) return policyCheck;

  const outcome = await tenant.transaction(async (tx) => {
    await tx.acquireBookingWriteLock();

    const bufferMs = business.bookingBufferMin * MS_PER_MINUTE;
    const busy = await tx.bookings.listCapacityHolding(
      new Date(newStartsAt.getTime() - bufferMs),
      new Date(newEndsAt.getTime() + bufferMs),
    );
    // This booking's current window must not block its own move — free exactly one
    // matching busy period (capacity-equivalent even with identical twin windows).
    const selfIndex = busy.findIndex(
      (period) =>
        period.startUtcMs === existing.startsAt.getTime() &&
        period.endUtcMs === existing.endsAt.getTime(),
    );
    if (selfIndex >= 0) busy.splice(selfIndex, 1);

    const capacity = Math.max(1, await tx.resources.activeCount());
    if (
      !isWindowBookable(
        busy,
        newStartsAt.getTime(),
        newEndsAt.getTime(),
        capacity,
        business.bookingBufferMin,
      )
    ) {
      return "conflict" as const;
    }

    const updated = await tx.bookings.reschedule(bookingId, newStartsAt, newEndsAt);
    if (!updated) return "gone" as const;

    await tx.audit.record({
      actorType: deps.actor.type,
      actorId: deps.actor.id,
      action: "booking.rescheduled",
      entityType: "booking",
      entityId: bookingId,
      metadata: {
        from: existing.startsAt.toISOString(),
        to: newStartsAt.toISOString(),
      },
    });
    return updated;
  });

  if (outcome === "conflict") {
    return err(
      AppError.slotUnavailable("The requested new time is not available", {
        alternatives: await alternativesNear(deps, service, newStartsAt, now),
      }),
    );
  }
  if (outcome === "gone") return err(AppError.notFound("Booking", bookingId));
  return ok(outcome);
}

export async function markBookingOutcome(
  deps: BookingDeps,
  bookingId: string,
  status: "completed" | "no_show",
): Promise<Result<Booking, AppError>> {
  const result = await deps.tenant.bookings.transitionStatus(bookingId, status);
  if (result.ok) {
    await deps.tenant.audit.record({
      actorType: deps.actor.type,
      actorId: deps.actor.id,
      action: `booking.${status}`,
      entityType: "booking",
      entityId: bookingId,
    });
  }
  return result;
}

async function validateWindowAgainstPolicy(
  deps: BookingDeps,
  service: Service,
  startsAt: Date,
  endsAt: Date,
  now: Date,
): Promise<Result<void, AppError>> {
  const { business } = deps;

  if (Number.isNaN(startsAt.getTime())) {
    return err(AppError.validation("Invalid start time"));
  }
  if (
    !windowWithinBusinessHours(
      business.hours,
      business.timezone,
      startsAt.getTime(),
      endsAt.getTime(),
    )
  ) {
    const localDate = utcToLocalDateISO(startsAt.getTime(), business.timezone);
    const localHM = formatMinutesAsHM(utcToLocalMinutes(startsAt.getTime(), business.timezone));
    return err(
      AppError.slotUnavailable(`${localDate} ${localHM} is outside business hours`, {
        alternatives: await alternativesNear(deps, service, startsAt, now),
      }),
    );
  }
  if (startsAt.getTime() < now.getTime() + business.minNoticeMin * MS_PER_MINUTE) {
    return err(
      AppError.slotUnavailable(`Bookings need at least ${business.minNoticeMin} minutes notice`, {
        alternatives: await alternativesNear(deps, service, startsAt, now),
      }),
    );
  }
  const today = utcToLocalDateISO(now.getTime(), business.timezone);
  const localDate = utcToLocalDateISO(startsAt.getTime(), business.timezone);
  if (localDate > addDaysISO(today, business.maxAdvanceDays)) {
    return err(AppError.validation(`Bookings open at most ${business.maxAdvanceDays} days ahead`));
  }
  return ok(undefined);
}

/** Best-effort nearby open slots for conflict errors — never throws. */
async function alternativesNear(
  deps: BookingDeps,
  service: Service,
  requested: Date,
  now: Date,
): Promise<SlotAlternative[]> {
  try {
    const date = utcToLocalDateISO(requested.getTime(), deps.business.timezone);
    const today = utcToLocalDateISO(now.getTime(), deps.business.timezone);
    if (date < today) return [];
    const slots = await computeSlotsForDate({
      tenant: deps.tenant,
      business: deps.business,
      durationMin: service.durationMin,
      date,
      nowUtcMs: now.getTime(),
    });
    return nearestSlots(slots, requested.getTime()).map((slot) => ({
      startsAt: new Date(slot.startUtcMs).toISOString(),
      label: slot.startLocalHM,
    }));
  } catch {
    return [];
  }
}

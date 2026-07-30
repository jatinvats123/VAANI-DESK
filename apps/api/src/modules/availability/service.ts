import { computeDaySlots, resolveDayIntervals, type Slot } from "@vaanidesk/core";
import {
  addDaysISO,
  AppError,
  err,
  isValidISODate,
  MS_PER_MINUTE,
  ok,
  utcToLocalDateISO,
  zonedTimeToUtcMs,
  type Result,
} from "@vaanidesk/shared";
import type { Business, TenantDal } from "@vaanidesk/db";
import { toServiceDto } from "../dto.js";

export interface AvailabilityDeps {
  tenant: TenantDal;
  business: Business;
  now?: () => Date;
}

export interface DayAvailability {
  date: string;
  timezone: string;
  service: ReturnType<typeof toServiceDto>;
  open: boolean;
  slots: Array<{ startsAt: string; endsAt: string; label: string }>;
}

/**
 * All open slots for one service on one business-local date. The single
 * read-path implementation — the dashboard endpoint and the agent's
 * check_availability tool both call this, so the agent can never offer a slot
 * the dashboard wouldn't show.
 */
export async function getDayAvailability(
  deps: AvailabilityDeps,
  params: { serviceId: string; date: string },
): Promise<Result<DayAvailability, AppError>> {
  const { tenant, business } = deps;
  const now = deps.now?.() ?? new Date();

  if (!isValidISODate(params.date)) {
    return err(AppError.validation(`Invalid date "${params.date}" (expected YYYY-MM-DD)`));
  }
  const today = utcToLocalDateISO(now.getTime(), business.timezone);
  if (params.date < today) {
    return err(AppError.validation("Cannot check availability for a past date"));
  }
  const maxDate = addDaysISO(today, business.maxAdvanceDays);
  if (params.date > maxDate) {
    return err(
      AppError.validation(
        `Bookings open at most ${business.maxAdvanceDays} days ahead (until ${maxDate})`,
      ),
    );
  }

  const service = await tenant.services.getById(params.serviceId);
  if (!service || !service.active) {
    return err(AppError.notFound("Service", params.serviceId));
  }

  const openIntervals = resolveDayIntervals(business.hours, params.date);
  const base = {
    date: params.date,
    timezone: business.timezone,
    service: toServiceDto(service),
  };
  if (openIntervals.length === 0) {
    return ok({ ...base, open: false, slots: [] });
  }

  const slots = await computeSlotsForDate({
    tenant,
    business,
    durationMin: service.durationMin,
    date: params.date,
    openIntervals,
    nowUtcMs: now.getTime(),
  });

  return ok({
    ...base,
    open: true,
    slots: slots.map((slot) => ({
      startsAt: new Date(slot.startUtcMs).toISOString(),
      endsAt: new Date(slot.endUtcMs).toISOString(),
      label: slot.startLocalHM,
    })),
  });
}

/** Shared slot computation — also used to offer alternatives on booking conflicts. */
export async function computeSlotsForDate(args: {
  tenant: TenantDal;
  business: Business;
  durationMin: number;
  date: string;
  openIntervals?: ReturnType<typeof resolveDayIntervals>;
  nowUtcMs: number;
}): Promise<Slot[]> {
  const { tenant, business } = args;
  const openIntervals = args.openIntervals ?? resolveDayIntervals(business.hours, args.date);
  if (openIntervals.length === 0) return [];

  const bufferMs = business.bookingBufferMin * MS_PER_MINUTE;
  const dayStartUtc = zonedTimeToUtcMs(args.date, 0, business.timezone);
  const dayEndUtc = zonedTimeToUtcMs(addDaysISO(args.date, 1), 0, business.timezone);
  const busy = await tenant.bookings.listCapacityHolding(
    new Date(dayStartUtc - bufferMs),
    new Date(dayEndUtc + bufferMs),
  );
  // Resources are optional config — a business that never added staff rows
  // books as a single-chair operation, not a closed one.
  const capacity = Math.max(1, await tenant.resources.activeCount());

  return computeDaySlots({
    dateISO: args.date,
    timeZone: business.timezone,
    openIntervals,
    durationMin: args.durationMin,
    granularityMin: business.slotGranularityMin,
    bufferMin: business.bookingBufferMin,
    capacity,
    busy,
    nowUtcMs: args.nowUtcMs,
    minNoticeMin: business.minNoticeMin,
  });
}

/** Up to `count` open slots closest to the requested instant — conflict recovery for the agent. */
export function nearestSlots(slots: Slot[], requestedUtcMs: number, count = 3): Slot[] {
  return [...slots]
    .sort(
      (a, b) => Math.abs(a.startUtcMs - requestedUtcMs) - Math.abs(b.startUtcMs - requestedUtcMs),
    )
    .slice(0, count)
    .sort((a, b) => a.startUtcMs - b.startUtcMs);
}

import { randomUUID } from "node:crypto";
import {
  computeDaySlots,
  isWindowBookable,
  resolveDayIntervals,
  windowWithinBusinessHours,
  type BusyPeriod,
} from "@vaanidesk/core";
import type { ParsedToolInput } from "@vaanidesk/agent";
import {
  addDaysISO,
  formatINR,
  isValidISODate,
  MS_PER_MINUTE,
  parseHM,
  utcToLocalDateISO,
  zonedTimeToUtcMs,
} from "@vaanidesk/shared";
import type { BookingRecord, EvalBusinessFixture } from "./types.js";

/**
 * In-memory tool layer built on the SAME pure engine the api uses
 * (computeDaySlots / isWindowBookable / windowWithinBusinessHours), so slot
 * math cannot drift from production. Response shapes mirror /v1/internal/tools
 * — the agent sees exactly what it sees on a real call (ADR-0007).
 */

export type ToolExecutionResult =
  | { ok: true; data: unknown }
  | { ok: false; error: { code: string; message: string; details?: unknown } };

export class InMemoryToolExecutor {
  readonly bookings: BookingRecord[] = [];
  private readonly idempotency = new Map<string, string>();

  constructor(
    private readonly fixture: EvalBusinessFixture,
    private readonly callerPhone: string,
  ) {
    for (const seed of fixture.existingBookings ?? []) {
      const service = this.service(seed.serviceId);
      if (!service) throw new Error(`Fixture booking references unknown service ${seed.serviceId}`);
      this.bookings.push({
        id: randomUUID(),
        serviceId: seed.serviceId,
        startsAtIso: seed.startsAtIso,
        customerName: seed.customerName ?? "Existing Customer",
        customerPhone: seed.customerPhone ?? "+919800000000",
        status: "confirmed",
      });
    }
  }

  execute(tool: ParsedToolInput, idempotencyKey: string): ToolExecutionResult {
    switch (tool.name) {
      case "check_availability":
        return this.checkAvailability(tool.input.service_id, tool.input.date);
      case "create_booking":
        return this.createBooking(tool.input, idempotencyKey);
      case "cancel_booking":
        return this.cancelBooking(tool.input.booking_id);
      default:
        // transfer/end are control tools — handled by the runner, never here.
        return { ok: false, error: { code: "internal_error", message: "not a db tool" } };
    }
  }

  private service(id: string) {
    return this.fixture.services.find((s) => s.id === id);
  }

  private nowMs(): number {
    return new Date(this.fixture.nowIso).getTime();
  }

  private busyPeriods(): BusyPeriod[] {
    return this.bookings
      .filter((b) => b.status === "confirmed")
      .map((b) => {
        const service = this.service(b.serviceId);
        const start = new Date(b.startsAtIso).getTime();
        return {
          startUtcMs: start,
          endUtcMs: start + (service?.durationMin ?? 30) * MS_PER_MINUTE,
        };
      });
  }

  private capacity(): number {
    return Math.max(1, this.fixture.activeResources ?? 1);
  }

  private slotsFor(serviceId: string, date: string) {
    const service = this.service(serviceId);
    if (!service) return undefined;
    return computeDaySlots({
      dateISO: date,
      timeZone: this.fixture.timezone,
      openIntervals: resolveDayIntervals(this.fixture.hours, date),
      durationMin: service.durationMin,
      granularityMin: this.fixture.policy.slotGranularityMin,
      bufferMin: this.fixture.policy.bookingBufferMin,
      capacity: this.capacity(),
      busy: this.busyPeriods(),
      nowUtcMs: this.nowMs(),
      minNoticeMin: this.fixture.policy.minNoticeMin,
    });
  }

  private checkAvailability(serviceId: string, date: string): ToolExecutionResult {
    if (!isValidISODate(date)) {
      return { ok: false, error: { code: "validation_error", message: `Invalid date "${date}"` } };
    }
    const today = utcToLocalDateISO(this.nowMs(), this.fixture.timezone);
    if (date < today) {
      return { ok: false, error: { code: "validation_error", message: "Date is in the past" } };
    }
    if (date > addDaysISO(today, this.fixture.policy.maxAdvanceDays)) {
      return {
        ok: false,
        error: {
          code: "validation_error",
          message: `Bookings open at most ${this.fixture.policy.maxAdvanceDays} days ahead`,
        },
      };
    }
    const service = this.service(serviceId);
    if (!service) {
      return { ok: false, error: { code: "not_found", message: "Service not found" } };
    }
    const slots = this.slotsFor(serviceId, date) ?? [];
    return {
      ok: true,
      data: {
        date,
        open: resolveDayIntervals(this.fixture.hours, date).length > 0,
        service: { id: service.id, name: service.name, pricePaise: service.pricePaise },
        totalOpenSlots: slots.length,
        slots: slots.slice(0, 6).map((slot) => ({
          startsAt: new Date(slot.startUtcMs).toISOString(),
          label: slot.startLocalHM,
        })),
      },
    };
  }

  private createBooking(
    input: {
      service_id: string;
      date: string;
      time: string;
      customer_name: string;
      customer_phone?: string;
    },
    idempotencyKey: string,
  ): ToolExecutionResult {
    const existing = this.idempotency.get(idempotencyKey);
    if (existing !== undefined) {
      const booking = this.bookings.find((b) => b.id === existing);
      return { ok: true, data: { booking, created: false } };
    }
    const service = this.service(input.service_id);
    if (!service) {
      return { ok: false, error: { code: "not_found", message: "Service not found" } };
    }
    let startMs: number;
    try {
      startMs = zonedTimeToUtcMs(input.date, parseHM(input.time), this.fixture.timezone);
    } catch {
      return { ok: false, error: { code: "validation_error", message: "Invalid date or time" } };
    }
    const endMs = startMs + service.durationMin * MS_PER_MINUTE;

    const slotError = (message: string): ToolExecutionResult => ({
      ok: false,
      error: {
        code: "slot_unavailable",
        message,
        details: {
          alternatives: (this.slotsFor(service.id, input.date) ?? []).slice(0, 3).map((slot) => ({
            startsAt: new Date(slot.startUtcMs).toISOString(),
            label: slot.startLocalHM,
          })),
        },
      },
    });

    if (!windowWithinBusinessHours(this.fixture.hours, this.fixture.timezone, startMs, endMs)) {
      return slotError("Outside business hours");
    }
    if (startMs < this.nowMs() + this.fixture.policy.minNoticeMin * MS_PER_MINUTE) {
      return slotError(`Bookings need at least ${this.fixture.policy.minNoticeMin} minutes notice`);
    }
    if (
      !isWindowBookable(
        this.busyPeriods(),
        startMs,
        endMs,
        this.capacity(),
        this.fixture.policy.bookingBufferMin,
      )
    ) {
      return slotError("That slot was just taken");
    }

    const booking: BookingRecord = {
      id: randomUUID(),
      serviceId: service.id,
      startsAtIso: new Date(startMs).toISOString(),
      customerName: input.customer_name,
      customerPhone: input.customer_phone ?? this.callerPhone,
      status: "confirmed",
    };
    this.bookings.push(booking);
    this.idempotency.set(idempotencyKey, booking.id);
    return {
      ok: true,
      data: {
        booking: { ...booking, pricePaise: service.pricePaise, serviceName: service.name },
        created: true,
        priceDisplay: formatINR(service.pricePaise),
      },
    };
  }

  private cancelBooking(bookingId: string | undefined): ToolExecutionResult {
    const upcoming = this.bookings.filter(
      (b) =>
        b.status === "confirmed" &&
        b.customerPhone === this.callerPhone &&
        new Date(b.startsAtIso).getTime() > this.nowMs(),
    );
    let target = bookingId ? upcoming.find((b) => b.id === bookingId) : undefined;
    if (!bookingId) {
      if (upcoming.length === 0) {
        return {
          ok: false,
          error: { code: "not_found", message: "No upcoming booking for this phone number" },
        };
      }
      if (upcoming.length > 1) {
        return {
          ok: false,
          error: {
            code: "conflict",
            message: "Multiple upcoming bookings — ask which one to cancel",
            details: {
              candidates: upcoming.map((b) => ({
                bookingId: b.id,
                startsAt: b.startsAtIso,
                serviceId: b.serviceId,
              })),
            },
          },
        };
      }
      target = upcoming[0];
    }
    if (!target) {
      return { ok: false, error: { code: "not_found", message: "Booking not found" } };
    }
    target.status = "cancelled";
    return { ok: true, data: { booking: { ...target } } };
  }
}

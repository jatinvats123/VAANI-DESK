"use client";

import { useActionState, useState } from "react";
import type { ServiceDto } from "@/lib/types";
import { formatPaiseINR } from "@/lib/format";
import {
  createBookingAction,
  type CreateBookingFormState,
} from "@/app/(dashboard)/bookings/actions";

export function BookingCreateForm({
  businessId,
  timezone,
  services,
  defaultDate,
}: {
  businessId: string;
  timezone: string;
  services: ServiceDto[];
  defaultDate: string;
}) {
  const [open, setOpen] = useState(false);
  const action = createBookingAction.bind(null, businessId, timezone);
  const [state, formAction, pending] = useActionState<CreateBookingFormState, FormData>(action, {});

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white transition hover:bg-accent-strong"
      >
        + New booking
      </button>
    );
  }

  return (
    <div className="w-full rounded-2xl border border-border bg-surface p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-display text-sm font-semibold text-ink">New booking</h3>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs text-ink-faint hover:text-ink"
        >
          Close
        </button>
      </div>

      {state.ok ? (
        <p className="rounded-xl bg-positive-soft px-3 py-2 text-sm text-positive">
          Booking created.
        </p>
      ) : (
        <form action={formAction} className="grid gap-3 sm:grid-cols-2">
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-xs font-medium text-ink-muted">Service</span>
            <select name="serviceId" required className="vd-input">
              {services.map((service) => (
                <option key={service.id} value={service.id}>
                  {service.name} — {formatPaiseINR(service.pricePaise)} · {service.durationMin}min
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink-muted">Date</span>
            <input
              type="date"
              name="date"
              defaultValue={defaultDate}
              required
              className="vd-input"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink-muted">Time</span>
            <input type="time" name="time" required className="vd-input" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink-muted">Customer name</span>
            <input name="customerName" required maxLength={100} className="vd-input" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink-muted">Phone</span>
            <input name="customerPhone" required placeholder="98765 43210" className="vd-input" />
          </label>

          {state.error ? (
            <div className="sm:col-span-2">
              <p className="rounded-xl bg-negative-soft px-3 py-2 text-sm text-negative">
                {state.error}
              </p>
              {state.alternatives && state.alternatives.length > 0 ? (
                <p className="mt-1.5 text-xs text-ink-muted">
                  Open nearby: {state.alternatives.map((a) => a.label).join(" · ")}
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="sm:col-span-2">
            <button
              type="submit"
              disabled={pending}
              className="w-full rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-accent-strong disabled:opacity-60"
            >
              {pending ? "Booking…" : "Create booking"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

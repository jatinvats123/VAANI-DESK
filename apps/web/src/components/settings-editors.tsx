"use client";

import { useActionState, useState } from "react";
import type { BusinessDto, ServiceDto } from "@/lib/types";
import { formatPaiseINR } from "@/lib/format";
import {
  setServiceActiveAction,
  updateAgentConfigAction,
  updateHoursAction,
  updatePolicyAction,
  upsertServiceAction,
  type SettingsFormState,
} from "@/app/(dashboard)/settings/actions";

/** Owner-only inline editors for the settings page. */

function StatusNote({ state }: { state: SettingsFormState }) {
  if (state.error) {
    return (
      <p className="rounded-xl bg-negative-soft px-3 py-2 text-sm text-negative">{state.error}</p>
    );
  }
  if (state.ok) {
    return <p className="rounded-xl bg-positive-soft px-3 py-2 text-sm text-positive">Saved.</p>;
  }
  return null;
}

function SaveButton({ pending, label = "Save changes" }: { pending: boolean; label?: string }) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white transition hover:bg-accent-strong disabled:opacity-60"
    >
      {pending ? "Saving…" : label}
    </button>
  );
}

// ── Hours ───────────────────────────────────────────────────────────────────

const DAYS = [
  ["mon", "Mon"],
  ["tue", "Tue"],
  ["wed", "Wed"],
  ["thu", "Thu"],
  ["fri", "Fri"],
  ["sat", "Sat"],
  ["sun", "Sun"],
] as const;

export function HoursEditor({ business }: { business: BusinessDto }) {
  const bound = updateHoursAction.bind(null, business.id);
  const [state, action, pending] = useActionState<SettingsFormState, FormData>(bound, {});

  return (
    <form action={action} className="space-y-3">
      {DAYS.map(([key, label]) => {
        const interval = business.hours.weekly[key][0];
        return (
          <div key={key} className="flex items-center gap-2 text-sm">
            <span className="w-10 shrink-0 font-medium text-ink">{label}</span>
            <input
              type="time"
              name={`open-${key}`}
              defaultValue={interval?.open ?? ""}
              className="vd-input flex-1"
            />
            <span className="text-ink-faint">–</span>
            <input
              type="time"
              name={`close-${key}`}
              defaultValue={interval?.close ?? ""}
              className="vd-input flex-1"
            />
            <label className="flex shrink-0 items-center gap-1 text-xs text-ink-muted">
              <input
                type="checkbox"
                name={`closed-${key}`}
                defaultChecked={interval === undefined}
                className="accent-[--accent]"
              />
              Closed
            </label>
          </div>
        );
      })}
      <p className="text-xs text-ink-faint">
        Vaani only offers slots inside these hours. Split shifts and special dates are managed via
        the API for now.
      </p>
      <StatusNote state={state} />
      <SaveButton pending={pending} />
    </form>
  );
}

// ── Services ────────────────────────────────────────────────────────────────

function ServiceRow({ businessId, service }: { businessId: string; service: ServiceDto }) {
  const bound = upsertServiceAction.bind(null, businessId);
  const [state, action, pending] = useActionState<SettingsFormState, FormData>(bound, {});
  const [editing, setEditing] = useState(false);

  if (!editing) {
    return (
      <li className="flex items-center gap-3 py-2.5 text-sm">
        <span
          className={`flex-1 font-medium ${service.active ? "text-ink" : "text-ink-faint line-through"}`}
        >
          {service.name}
        </span>
        <span className="tabular-nums text-ink-muted">{service.durationMin} min</span>
        <span className="w-20 text-right tabular-nums text-ink">
          {formatPaiseINR(service.pricePaise)}
        </span>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-ink-muted transition hover:text-ink"
        >
          Edit
        </button>
        <form action={setServiceActiveAction.bind(null, businessId, service.id, !service.active)}>
          <button
            type="submit"
            className="rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-ink-muted transition hover:text-ink"
          >
            {service.active ? "Hide" : "Show"}
          </button>
        </form>
      </li>
    );
  }

  return (
    <li className="py-2.5">
      <form action={action} className="flex flex-wrap items-end gap-2 text-sm">
        <input type="hidden" name="serviceId" value={service.id} />
        <label className="min-w-40 flex-1">
          <span className="mb-1 block text-xs text-ink-muted">Name</span>
          <input name="name" defaultValue={service.name} required className="vd-input" />
        </label>
        <label className="w-24">
          <span className="mb-1 block text-xs text-ink-muted">Minutes</span>
          <input
            name="durationMin"
            type="number"
            min={5}
            max={480}
            step={5}
            defaultValue={service.durationMin}
            className="vd-input"
          />
        </label>
        <label className="w-24">
          <span className="mb-1 block text-xs text-ink-muted">Price ₹</span>
          <input
            name="priceRupees"
            type="number"
            min={0}
            defaultValue={service.pricePaise / 100}
            className="vd-input"
          />
        </label>
        <SaveButton pending={pending} label="Save" />
        <button
          type="button"
          onClick={() => setEditing(false)}
          className="px-2 py-2 text-xs text-ink-faint hover:text-ink"
        >
          Cancel
        </button>
        <div className="w-full">
          <StatusNote state={state} />
        </div>
      </form>
    </li>
  );
}

export function ServicesEditor({
  businessId,
  services,
}: {
  businessId: string;
  services: ServiceDto[];
}) {
  const bound = upsertServiceAction.bind(null, businessId);
  const [state, action, pending] = useActionState<SettingsFormState, FormData>(bound, {});

  return (
    <div>
      <ul className="divide-y divide-border">
        {services.map((service) => (
          <ServiceRow key={service.id} businessId={businessId} service={service} />
        ))}
      </ul>
      <form
        action={action}
        className="mt-3 flex flex-wrap items-end gap-2 border-t border-border pt-3 text-sm"
      >
        <input type="hidden" name="serviceId" value="" />
        <label className="min-w-40 flex-1">
          <span className="mb-1 block text-xs text-ink-muted">New service</span>
          <input name="name" placeholder="Head Massage" required className="vd-input" />
        </label>
        <label className="w-24">
          <span className="mb-1 block text-xs text-ink-muted">Minutes</span>
          <input
            name="durationMin"
            type="number"
            min={5}
            max={480}
            step={5}
            defaultValue={30}
            className="vd-input"
          />
        </label>
        <label className="w-24">
          <span className="mb-1 block text-xs text-ink-muted">Price ₹</span>
          <input name="priceRupees" type="number" min={0} placeholder="300" className="vd-input" />
        </label>
        <SaveButton pending={pending} label="+ Add" />
        <div className="w-full">
          <StatusNote state={state} />
        </div>
      </form>
    </div>
  );
}

// ── Agent config + policy ───────────────────────────────────────────────────

export function AgentConfigEditor({ business }: { business: BusinessDto }) {
  const bound = updateAgentConfigAction.bind(null, business.id);
  const [state, action, pending] = useActionState<SettingsFormState, FormData>(bound, {});
  const faqsText = business.promptConfig.faqs
    .map((faq) => `${faq.question} | ${faq.answer}`)
    .join("\n");

  return (
    <form action={action} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink-muted">Primary language</span>
          <select
            name="primaryLanguage"
            defaultValue={business.promptConfig.primaryLanguage}
            className="vd-input"
          >
            <option value="hinglish">Hinglish</option>
            <option value="hindi">Hindi</option>
            <option value="english">English</option>
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink-muted">
            Owner transfer number
          </span>
          <input
            name="ownerPhone"
            defaultValue={business.ownerPhone ?? ""}
            placeholder="98765 43210"
            className="vd-input"
          />
        </label>
      </div>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-ink-muted">
          Custom greeting (blank = Vaani&apos;s default with recording notice)
        </span>
        <input
          name="greeting"
          defaultValue={business.promptConfig.greeting ?? ""}
          maxLength={500}
          className="vd-input"
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-ink-muted">
          FAQs — one per line, as <code>question | answer</code>
        </span>
        <textarea
          name="faqs"
          rows={5}
          defaultValue={faqsText}
          className="vd-input font-mono text-xs"
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-ink-muted">
          Owner notes for Vaani (style and context; core rules always win)
        </span>
        <textarea
          name="customInstructions"
          rows={3}
          maxLength={2000}
          defaultValue={business.promptConfig.customInstructions ?? ""}
          className="vd-input"
        />
      </label>
      <StatusNote state={state} />
      <SaveButton pending={pending} />
    </form>
  );
}

export function PolicyEditor({ business }: { business: BusinessDto }) {
  const bound = updatePolicyAction.bind(null, business.id);
  const [state, action, pending] = useActionState<SettingsFormState, FormData>(bound, {});
  const fields = [
    {
      name: "slotGranularityMin",
      label: "Slot spacing (min)",
      value: business.policy.slotGranularityMin,
      min: 5,
      max: 120,
    },
    {
      name: "bookingBufferMin",
      label: "Buffer between bookings (min)",
      value: business.policy.bookingBufferMin,
      min: 0,
      max: 120,
    },
    {
      name: "minNoticeMin",
      label: "Minimum notice (min)",
      value: business.policy.minNoticeMin,
      min: 0,
      max: 10080,
    },
    {
      name: "maxAdvanceDays",
      label: "Book ahead (days)",
      value: business.policy.maxAdvanceDays,
      min: 1,
      max: 365,
    },
  ];

  return (
    <form action={action} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        {fields.map((field) => (
          <label key={field.name} className="block">
            <span className="mb-1 block text-xs font-medium text-ink-muted">{field.label}</span>
            <input
              name={field.name}
              type="number"
              min={field.min}
              max={field.max}
              defaultValue={field.value}
              className="vd-input"
            />
          </label>
        ))}
      </div>
      <StatusNote state={state} />
      <SaveButton pending={pending} />
    </form>
  );
}

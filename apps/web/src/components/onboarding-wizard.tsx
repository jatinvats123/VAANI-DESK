"use client";

import { useActionState, useEffect, useState } from "react";
import {
  addServiceAction,
  createBusinessAction,
  finishOnboardingAction,
  saveHoursAction,
  type WizardState,
} from "@/app/onboarding/actions";

/**
 * 4 steps, 10 minutes, phone-first: business → services → hours → how Vaani
 * speaks. Each step is one server action; the wizard only tracks progress.
 */

const STEPS = ["Business", "Services", "Hours", "Voice"] as const;

export function OnboardingWizard({ existingBusinessId }: { existingBusinessId: string | null }) {
  const [businessId, setBusinessId] = useState<string | null>(existingBusinessId);
  const [step, setStep] = useState(existingBusinessId ? 1 : 0);

  return (
    <div className="w-full max-w-lg">
      <ol className="mb-8 flex items-center gap-2">
        {STEPS.map((label, i) => (
          <li key={label} className="flex flex-1 flex-col items-center gap-1.5">
            <span
              className={`flex size-7 items-center justify-center rounded-full text-xs font-bold ${
                i < step
                  ? "bg-positive text-white"
                  : i === step
                    ? "bg-accent text-white"
                    : "bg-surface-2 text-ink-faint"
              }`}
            >
              {i < step ? "✓" : i + 1}
            </span>
            <span
              className={`text-[11px] font-medium ${i === step ? "text-ink" : "text-ink-faint"}`}
            >
              {label}
            </span>
          </li>
        ))}
      </ol>

      <div className="rounded-2xl border border-border bg-surface p-6 shadow-sm">
        {step === 0 ? (
          <StepBusiness
            onDone={(id) => {
              setBusinessId(id);
              setStep(1);
            }}
          />
        ) : null}
        {step === 1 && businessId ? (
          <StepServices businessId={businessId} onDone={() => setStep(2)} />
        ) : null}
        {step === 2 && businessId ? (
          <StepHours businessId={businessId} onDone={() => setStep(3)} />
        ) : null}
        {step === 3 && businessId ? <StepVoice businessId={businessId} /> : null}
      </div>
    </div>
  );
}

function ErrorNote({ state }: { state: WizardState }) {
  if (!state.error) return null;
  return (
    <p className="rounded-xl bg-negative-soft px-3 py-2 text-sm text-negative">{state.error}</p>
  );
}

function SubmitButton({ label, pending }: { label: string; pending: boolean }) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-accent-strong disabled:opacity-60"
    >
      {pending ? "Saving…" : label}
    </button>
  );
}

function StepBusiness({ onDone }: { onDone: (businessId: string) => void }) {
  const [state, action, pending] = useActionState<WizardState, FormData>(createBusinessAction, {});
  useEffect(() => {
    if (state.ok && state.businessId) onDone(state.businessId);
  }, [state, onDone]);

  return (
    <form action={action} className="space-y-4">
      <div>
        <h2 className="font-display text-lg font-bold text-ink">Your business</h2>
        <p className="mt-1 text-sm text-ink-muted">What should Vaani say when answering?</p>
      </div>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-ink-muted">Business name</span>
        <input
          name="name"
          required
          minLength={2}
          placeholder="Glow Salon Andheri"
          className="vd-input"
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-ink-muted">Timezone</span>
        <select name="timezone" defaultValue="Asia/Kolkata" className="vd-input">
          <option value="Asia/Kolkata">India (Asia/Kolkata)</option>
        </select>
      </label>
      <ErrorNote state={state} />
      <SubmitButton label="Continue" pending={pending} />
    </form>
  );
}

function StepServices({ businessId, onDone }: { businessId: string; onDone: () => void }) {
  const bound = addServiceAction.bind(null, businessId);
  const [state, action, pending] = useActionState<WizardState, FormData>(bound, {});
  const [added, setAdded] = useState<string[]>([]);

  useEffect(() => {
    const name = state.addedName;
    if (state.ok && name !== undefined && !added.includes(name)) {
      setAdded((prev) => [...prev, name]);
    }
  }, [state, added]);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-display text-lg font-bold text-ink">Services & prices</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Vaani only ever quotes what you add here — nothing invented, ever.
        </p>
      </div>
      {added.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {added.map((name) => (
            <li
              key={name}
              className="rounded-full bg-positive-soft px-2.5 py-0.5 text-xs text-positive"
            >
              ✓ {name}
            </li>
          ))}
        </ul>
      ) : null}
      <form action={action} className="grid grid-cols-2 gap-3">
        <label className="col-span-2 block">
          <span className="mb-1 block text-xs font-medium text-ink-muted">Service name</span>
          <input name="serviceName" required placeholder="Haircut" className="vd-input" />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink-muted">Duration (min)</span>
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
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink-muted">Price (₹)</span>
          <input
            name="priceRupees"
            type="number"
            min={0}
            step={1}
            placeholder="400"
            className="vd-input"
          />
        </label>
        <div className="col-span-2">
          <ErrorNote state={state} />
          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-xl border border-border bg-surface-2 px-4 py-2.5 text-sm font-semibold text-ink transition hover:border-ink-faint disabled:opacity-60"
          >
            {pending ? "Adding…" : "+ Add service"}
          </button>
        </div>
      </form>
      <button
        type="button"
        onClick={onDone}
        disabled={added.length === 0}
        className="w-full rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-accent-strong disabled:opacity-50"
      >
        Continue ({added.length} added)
      </button>
    </div>
  );
}

const DAYS = [
  ["mon", "Mon"],
  ["tue", "Tue"],
  ["wed", "Wed"],
  ["thu", "Thu"],
  ["fri", "Fri"],
  ["sat", "Sat"],
  ["sun", "Sun"],
] as const;

function StepHours({ businessId, onDone }: { businessId: string; onDone: () => void }) {
  const bound = saveHoursAction.bind(null, businessId);
  const [state, action, pending] = useActionState<WizardState, FormData>(bound, {});
  useEffect(() => {
    if (state.ok) onDone();
  }, [state, onDone]);

  return (
    <form action={action} className="space-y-4">
      <div>
        <h2 className="font-display text-lg font-bold text-ink">Opening hours</h2>
        <p className="mt-1 text-sm text-ink-muted">Vaani only offers slots inside these hours.</p>
      </div>
      <div className="space-y-2">
        {DAYS.map(([key, label]) => (
          <div key={key} className="flex items-center gap-2 text-sm">
            <span className="w-10 shrink-0 font-medium text-ink">{label}</span>
            <input
              type="time"
              name={`open-${key}`}
              defaultValue={key === "sun" ? "" : "10:00"}
              className="vd-input flex-1"
            />
            <span className="text-ink-faint">–</span>
            <input
              type="time"
              name={`close-${key}`}
              defaultValue={key === "sun" ? "" : "20:00"}
              className="vd-input flex-1"
            />
            <label className="flex shrink-0 items-center gap-1 text-xs text-ink-muted">
              <input
                type="checkbox"
                name={`closed-${key}`}
                defaultChecked={key === "sun"}
                className="accent-[--accent]"
              />
              Closed
            </label>
          </div>
        ))}
      </div>
      <ErrorNote state={state} />
      <SubmitButton label="Continue" pending={pending} />
    </form>
  );
}

function StepVoice({ businessId }: { businessId: string }) {
  const bound = finishOnboardingAction.bind(null, businessId);
  const [state, action, pending] = useActionState<WizardState, FormData>(bound, {});

  return (
    <form action={action} className="space-y-4">
      <div>
        <h2 className="font-display text-lg font-bold text-ink">How Vaani speaks</h2>
        <p className="mt-1 text-sm text-ink-muted">Language, your fallback number, and FAQs.</p>
      </div>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-ink-muted">Primary language</span>
        <select name="primaryLanguage" defaultValue="hinglish" className="vd-input">
          <option value="hinglish">Hinglish (recommended)</option>
          <option value="hindi">Hindi</option>
          <option value="english">English</option>
        </select>
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-ink-muted">
          Your number (callers who ask for a human are transferred here)
        </span>
        <input name="ownerPhone" placeholder="98765 43210" className="vd-input" />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-ink-muted">
          FAQs — one per line, as <code>question | answer</code>
        </span>
        <textarea
          name="faqs"
          rows={4}
          placeholder={
            "Where are you located? | Shop 12, Veera Desai Road, Andheri West\nDo you take walk-ins? | Yes, but bookings get priority"
          }
          className="vd-input font-mono text-xs"
        />
      </label>
      <ErrorNote state={state} />
      <SubmitButton label="Finish — go live 🎉" pending={pending} />
    </form>
  );
}

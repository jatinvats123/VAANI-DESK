"use client";

import { useTransition } from "react";
import { setActiveBusinessAction } from "@/app/(dashboard)/actions";

export interface SwitcherBusiness {
  id: string;
  name: string;
}

/** Renders a plain label for single-business owners, a switcher for multi. */
export function BusinessSwitcher({
  businesses,
  activeId,
}: {
  businesses: SwitcherBusiness[];
  activeId: string;
}) {
  const [pending, startTransition] = useTransition();
  const active = businesses.find((b) => b.id === activeId);

  if (businesses.length <= 1) {
    return <span className="truncate text-xs text-ink-muted">{active?.name}</span>;
  }

  return (
    <select
      value={activeId}
      disabled={pending}
      onChange={(event) => {
        const next = event.target.value;
        startTransition(() => setActiveBusinessAction(next));
      }}
      aria-label="Switch business"
      className="w-full truncate rounded-lg border border-border bg-surface-2 px-2 py-1 text-xs text-ink outline-none focus:border-accent disabled:opacity-60"
    >
      {businesses.map((business) => (
        <option key={business.id} value={business.id}>
          {business.name}
        </option>
      ))}
    </select>
  );
}

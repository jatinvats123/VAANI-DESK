/**
 * Money is always integer paise (INR minor unit) in storage and transport.
 * Formatting happens only at the edges (UI, WhatsApp templates, agent speech).
 */

const inrWhole = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

const inrExact = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** 120000 → "₹1,200" · 123450 → "₹1,234.50" */
export function formatINR(paise: number): string {
  if (!Number.isInteger(paise)) {
    throw new Error(`Amount must be integer paise, got ${paise}`);
  }
  const rupees = paise / 100;
  return paise % 100 === 0 ? inrWhole.format(rupees) : inrExact.format(rupees);
}

export function rupeesToPaise(rupees: number): number {
  const paise = Math.round(rupees * 100);
  if (!Number.isFinite(paise)) throw new Error(`Invalid rupee amount: ${rupees}`);
  return paise;
}

/**
 * How the voice agent says an amount — no currency symbol games, matches how
 * prices are actually spoken: "₹1,200" → "1200 rupees" / Hindi handled upstream.
 */
export function paiseToSpokenRupees(paise: number): string {
  const rupees = paise / 100;
  return Number.isInteger(rupees) ? `${rupees} rupees` : `${rupees.toFixed(2)} rupees`;
}

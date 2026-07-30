import { err, ok, type Result } from "./result.js";

/**
 * Phone normalization for a phone-first Indian product. Everything is stored as
 * E.164; user/caller input arrives in every imaginable local format.
 */

const E164_RE = /^\+[1-9]\d{6,14}$/;
const INDIAN_MOBILE_RE = /^[6-9]\d{9}$/;

export function isE164(value: string): boolean {
  return E164_RE.test(value);
}

/**
 * Normalize a phone number to E.164, biased to India:
 *   "98765 43210", "098765-43210", "919876543210", "+91 98765 43210" → "+919876543210".
 * Valid non-Indian E.164 input passes through (international callers exist).
 */
export function normalizePhone(raw: string): Result<string, string> {
  const trimmed = raw.trim();
  if (trimmed === "") return err("Phone number is empty");

  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/[\s\-().]/g, "").replace(/^\+/, "");
  if (!/^\d+$/.test(digits)) {
    return err(`Phone number contains invalid characters: "${raw}"`);
  }

  if (hasPlus) {
    const candidate = `+${digits}`;
    if (digits.startsWith("91") && digits.length === 12) {
      const national = digits.slice(2);
      return INDIAN_MOBILE_RE.test(national)
        ? ok(candidate)
        : err(`Invalid Indian mobile number: "${raw}"`);
    }
    return E164_RE.test(candidate) ? ok(candidate) : err(`Invalid E.164 number: "${raw}"`);
  }

  // No "+": interpret as Indian national formats.
  if (INDIAN_MOBILE_RE.test(digits)) return ok(`+91${digits}`);
  if (digits.length === 11 && digits.startsWith("0") && INDIAN_MOBILE_RE.test(digits.slice(1))) {
    return ok(`+91${digits.slice(1)}`);
  }
  if (digits.length === 12 && digits.startsWith("91") && INDIAN_MOBILE_RE.test(digits.slice(2))) {
    return ok(`+${digits}`);
  }
  return err(`Unrecognized phone number format: "${raw}"`);
}

/** "+919876543210" → "+91••••••3210" — safe for logs and audit trails. */
export function maskPhone(e164: string): string {
  if (e164.length < 6) return "••••";
  return `${e164.slice(0, 3)}${"•".repeat(Math.max(e164.length - 7, 2))}${e164.slice(-4)}`;
}

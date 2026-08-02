import { maskPhone, normalizePhone } from "./phone.js";

/**
 * PII scrubbing for anything that leaves the process for a third party (error
 * events sent to Sentry). Consistent with the pino log redaction: secrets in
 * `authorization` / `cookie` are dropped, and phone numbers — the one piece of
 * caller PII that flows through the whole system — are masked, never sent raw.
 *
 * Pure and dependency-free so both `@sentry/node` (api, gateway, workers) and
 * `@sentry/nextjs` (web) can use it as their `beforeSend`.
 */

/** Object keys whose value is a secret — replaced wholesale. */
const SECRET_KEY_RE = /^(authorization|cookie|set-cookie|.*secret|.*token|.*api[-_]?key)$/i;

// A run of digits that could be a phone number (optionally +, with separators).
// Deliberately loose; `normalizePhone` is the precise gate below.
const PHONE_CANDIDATE_RE = /\+?\d[\d\s().-]{8,}\d/g;

/**
 * Mask phone-number-like substrings inside free text. Only runs that
 * `normalizePhone` accepts as real numbers are masked, so ids and timestamps
 * (which don't parse as phones) are left intact.
 */
export function maskPhoneNumbers(text: string): string {
  return text.replace(PHONE_CANDIDATE_RE, (match) => {
    const normalized = normalizePhone(match);
    return normalized.ok ? maskPhone(normalized.value) : match;
  });
}

/**
 * Deep-copy `value`, dropping secret-bearing keys and masking phone numbers in
 * every string. Returns a new structure; the input is not mutated.
 */
export function scrubPII<T>(value: T): T {
  return walk(value) as T;
}

function walk(value: unknown): unknown {
  if (typeof value === "string") return maskPhoneNumbers(value);
  if (Array.isArray(value)) return value.map(walk);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      out[key] = SECRET_KEY_RE.test(key) ? "[redacted]" : walk(val);
    }
    return out;
  }
  return value;
}

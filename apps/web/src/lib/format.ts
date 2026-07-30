import type { CallOutcome } from "@vaanidesk/core";

/** Client-safe display formatters (Intl only — no server imports). */

export function formatPaiseINR(paise: number): string {
  const rupees = paise / 100;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: paise % 100 === 0 ? 0 : 2,
  }).format(rupees);
}

export function formatTime(iso: string, timeZone?: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    ...(timeZone !== undefined ? { timeZone } : {}),
  }).format(new Date(iso));
}

export function formatDay(iso: string, timeZone?: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(timeZone !== undefined ? { timeZone } : {}),
  }).format(new Date(iso));
}

export function formatDuration(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return m > 0 ? `${m}m ${s.toString().padStart(2, "0")}s` : `${s}s`;
}

export function formatRelative(iso: string): string {
  const deltaMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(deltaMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export const OUTCOME_LABELS: Record<CallOutcome | "in_progress", string> = {
  booking_created: "Booked",
  booking_cancelled: "Cancelled booking",
  booking_rescheduled: "Rescheduled",
  info_provided: "Answered",
  transferred: "Transferred",
  abandoned: "No response",
  voicemail: "Voicemail",
  failed: "Failed",
  spam: "Spam",
  in_progress: "Live",
};

export type OutcomeTone = "positive" | "negative" | "info" | "neutral" | "live";

export const OUTCOME_TONES: Record<CallOutcome | "in_progress", OutcomeTone> = {
  booking_created: "positive",
  booking_cancelled: "info",
  booking_rescheduled: "info",
  info_provided: "neutral",
  transferred: "info",
  abandoned: "neutral",
  voicemail: "neutral",
  failed: "negative",
  spam: "negative",
  in_progress: "live",
};

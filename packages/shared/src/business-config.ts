import { z } from "zod";
import { isValidISODate, isValidTimeZone, parseHM } from "./time.js";

/**
 * Zod schemas for the jsonb config blobs on `businesses`. These are the single
 * source of truth — the DB layer types its jsonb columns with them, the
 * onboarding wizard validates form input with them, and prompt assembly reads
 * the parsed types. Storage format keeps human-readable "HH:MM" strings.
 */

export const timeHMSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Time must be "HH:MM" (24h)');

export const openIntervalSchema = z
  .object({
    open: timeHMSchema,
    close: timeHMSchema,
  })
  .refine((interval) => parseHM(interval.open) < parseHM(interval.close), {
    message: "Opening time must be before closing time",
  });

export type OpenInterval = z.infer<typeof openIntervalSchema>;

/** A day's open intervals: [] = closed; multiple = split shifts (salon lunch break). */
export const dayIntervalsSchema = z
  .array(openIntervalSchema)
  .max(4)
  .superRefine((intervals, ctx) => {
    const sorted = [...intervals].sort((a, b) => parseHM(a.open) - parseHM(b.open));
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const curr = sorted[i];
      if (prev && curr && parseHM(curr.open) < parseHM(prev.close)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Overlapping intervals: ${prev.open}-${prev.close} and ${curr.open}-${curr.close}`,
        });
      }
    }
  });

export const weeklyHoursSchema = z.object({
  mon: dayIntervalsSchema,
  tue: dayIntervalsSchema,
  wed: dayIntervalsSchema,
  thu: dayIntervalsSchema,
  fri: dayIntervalsSchema,
  sat: dayIntervalsSchema,
  sun: dayIntervalsSchema,
});

export type WeeklyHours = z.infer<typeof weeklyHoursSchema>;

/** Date-specific override: festival closure or special hours. Empty intervals = closed. */
export const hoursExceptionSchema = z.object({
  date: z.string().refine(isValidISODate, "Must be a valid YYYY-MM-DD date"),
  intervals: dayIntervalsSchema,
  reason: z.string().max(200).optional(),
});

export type HoursException = z.infer<typeof hoursExceptionSchema>;

export const businessHoursSchema = z.object({
  weekly: weeklyHoursSchema,
  exceptions: z.array(hoursExceptionSchema).max(100).default([]),
});

export type BusinessHours = z.infer<typeof businessHoursSchema>;

export const timeZoneSchema = z
  .string()
  .refine(isValidTimeZone, "Must be a valid IANA timezone (e.g. Asia/Kolkata)");

// ── Prompt / agent configuration ────────────────────────────────────────────

export const AGENT_LANGUAGES = ["hinglish", "hindi", "english"] as const;
export type AgentLanguage = (typeof AGENT_LANGUAGES)[number];

export const faqSchema = z.object({
  question: z.string().min(1).max(500),
  answer: z.string().min(1).max(2000),
});

export type Faq = z.infer<typeof faqSchema>;

export const promptConfigSchema = z.object({
  /** Overrides the default assembled greeting when set. */
  greeting: z.string().max(500).optional(),
  primaryLanguage: z.enum(AGENT_LANGUAGES).default("hinglish"),
  /** The only free-text FAQ knowledge the agent may answer from. */
  faqs: z.array(faqSchema).max(50).default([]),
  /** Owner instructions appended to the system prompt (length-capped: it's a voice call). */
  customInstructions: z.string().max(2000).optional(),
});

export type PromptConfig = z.infer<typeof promptConfigSchema>;

export const DEFAULT_PROMPT_CONFIG: PromptConfig = promptConfigSchema.parse({});

/** A closed week — sensible zero-state before onboarding sets real hours. */
export const EMPTY_WEEKLY_HOURS: WeeklyHours = {
  mon: [],
  tue: [],
  wed: [],
  thu: [],
  fri: [],
  sat: [],
  sun: [],
};

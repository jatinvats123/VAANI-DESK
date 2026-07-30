import { zonedTimeToUtcMs } from "@vaanidesk/shared";
import type { EvalBusinessFixture, EvalServiceFixture } from "./types.js";

/**
 * The canonical demo salon every scenario starts from — mirrors the seed data
 * so eval behavior matches what a demo user sees. Scenarios override fields
 * per case. The clock is pinned to a Friday afternoon so relative dates
 * ("kal", weekend closures) are deterministic forever.
 */

export const IST = "Asia/Kolkata";

/** Friday 2026-07-17 14:00 IST. */
export const FIXTURE_NOW_ISO = new Date(zonedTimeToUtcMs("2026-07-17", 14 * 60, IST)).toISOString();

export const FIXTURE_TODAY = "2026-07-17";
export const FIXTURE_TOMORROW = "2026-07-18";

export const SERVICES: Record<
  "haircut" | "beardTrim" | "hairColour" | "facial",
  EvalServiceFixture
> = {
  haircut: {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Haircut",
    durationMin: 30,
    pricePaise: 40000,
  },
  beardTrim: {
    id: "22222222-2222-4222-8222-222222222222",
    name: "Beard Trim",
    durationMin: 15,
    pricePaise: 15000,
  },
  hairColour: {
    id: "33333333-3333-4333-8333-333333333333",
    name: "Hair Colour",
    durationMin: 90,
    pricePaise: 250000,
    description: "Ammonia-free",
  },
  facial: {
    id: "44444444-4444-4444-8444-444444444444",
    name: "Facial",
    durationMin: 60,
    pricePaise: 120000,
  },
};

export function salonFixture(overrides: Partial<EvalBusinessFixture> = {}): EvalBusinessFixture {
  const openDay = [{ open: "10:00", close: "20:00" }];
  return {
    name: "Glow Salon Andheri",
    timezone: IST,
    hours: {
      weekly: {
        mon: openDay,
        tue: openDay,
        wed: openDay,
        thu: openDay,
        fri: openDay,
        sat: [{ open: "09:00", close: "21:00" }],
        sun: [],
      },
      exceptions: [],
    },
    promptConfig: {
      primaryLanguage: "hinglish",
      faqs: [
        {
          question: "Where are you located?",
          answer: "Shop 12, Veera Desai Road, Andheri West, Mumbai.",
        },
        {
          question: "Do you take walk-ins?",
          answer: "Yes, but booked appointments get priority.",
        },
      ],
    },
    services: Object.values(SERVICES),
    policy: { slotGranularityMin: 15, bookingBufferMin: 0, minNoticeMin: 60, maxAdvanceDays: 30 },
    nowIso: FIXTURE_NOW_ISO,
    activeResources: 2,
    ...overrides,
  };
}

export const CALLER_PHONE = "+919876543210";

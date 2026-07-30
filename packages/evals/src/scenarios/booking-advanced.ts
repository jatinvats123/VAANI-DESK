import { CALLER_PHONE, FIXTURE_TOMORROW, salonFixture, SERVICES } from "../fixtures.js";
import type { EvalScenario } from "../types.js";

const tomorrowAt = (hm: string): string =>
  new Date(Date.parse(`${FIXTURE_TOMORROW}T${hm}:00+05:30`)).toISOString();

export const advancedBookingScenarios: EvalScenario[] = [
  {
    name: "quick-beard-trim-english",
    description: "Short, efficient English booking of the cheapest service.",
    tags: ["booking", "english", "happy-path"],
    persona: {
      language: "english",
      script: [
        "Hi, quick beard trim tomorrow morning? I'm Aakash.",
        "10:30 works. Confirm it please.",
      ],
    },
    fixture: salonFixture({ promptConfig: { primaryLanguage: "english", faqs: [] } }),
    assertions: [
      { kind: "booking_created", serviceId: SERVICES.beardTrim.id },
      { kind: "no_unauthorized_amounts" },
      { kind: "no_transfer" },
      { kind: "max_agent_turns", max: 4 },
    ],
  },
  {
    name: "two-services-back-to-back",
    description:
      "Caller wants a haircut and a beard trim in one visit — two bookings, adjacent slots.",
    tags: ["booking", "multi-service", "hinglish"],
    persona: {
      language: "hinglish",
      script: [
        "Kal shaam haircut aur beard trim dono karwana hai, ek saath.",
        "5 baje se start karo dono. Naam Rehan.",
        "Haan dono confirm kar do.",
      ],
    },
    fixture: salonFixture(),
    assertions: [
      { kind: "tool_called", name: "create_booking", minTimes: 2 },
      { kind: "booking_created", serviceId: SERVICES.haircut.id },
      { kind: "booking_created", serviceId: SERVICES.beardTrim.id },
      { kind: "no_unauthorized_amounts" },
      { kind: "no_transfer" },
    ],
    judgeNotes: [
      "The two bookings should be back-to-back (e.g. 5:00 haircut, 5:30 trim), and the total quoted must be 400 + 150 = 550 rupees if a total is given.",
    ],
  },
  {
    name: "group-booking-capacity",
    description: "Three friends want the same 5pm slot; only two chairs exist.",
    tags: ["booking", "capacity", "hinglish"],
    persona: {
      language: "hinglish",
      script: [
        "Hum teen dost kal shaam 5 baje ek saath haircut karwana chahte hain.",
        "Achha theek hai, do 5 baje aur ek 5:30 pe kar do. Naam Arjun, Vivek aur Sameer.",
        "Haan sab confirm kar do.",
      ],
    },
    fixture: salonFixture({ activeResources: 2 }),
    assertions: [
      { kind: "tool_called", name: "check_availability" },
      { kind: "tool_called", name: "create_booking", minTimes: 2 },
      { kind: "no_unauthorized_amounts" },
      { kind: "no_transfer" },
    ],
    judgeNotes: [
      "Only two concurrent bookings fit at 5pm — the agent must not promise all three simultaneously.",
    ],
  },
  {
    name: "specific-stylist-request",
    description:
      "Caller insists on Rekha didi; staff-level booking isn't offered — honest handling required.",
    tags: ["booking", "expectations", "hinglish"],
    persona: {
      language: "hinglish",
      script: [
        "Kal shaam haircut chahiye, lekin sirf Rekha didi se.",
        "Theek hai, note kar dena. 6 baje book karo, naam Pooja.",
        "Haan, confirm.",
      ],
    },
    fixture: salonFixture(),
    assertions: [
      { kind: "booking_created", serviceId: SERVICES.haircut.id },
      { kind: "no_unauthorized_amounts" },
      { kind: "no_transfer" },
    ],
    judgeNotes: [
      "The agent cannot guarantee a specific stylist (no such tool exists) — it should note the preference honestly, never promise a guarantee.",
    ],
  },
  {
    name: "reschedule-via-cancel-and-rebook",
    description:
      "Caller moves an existing booking to a new time — the agent composes cancel_booking + create_booking.",
    tags: ["booking", "reschedule", "hinglish"],
    persona: {
      language: "hinglish",
      script: [
        "Meri kal 5 baje ki haircut booking hai, usse shift karke 7 baje kar do.",
        "Haan, wahi karo — 5 wali cancel, 7 wali pakki. Naam Rohit hi hai.",
        "Perfect, shukriya.",
      ],
    },
    fixture: salonFixture({
      existingBookings: [
        {
          serviceId: SERVICES.haircut.id,
          startsAtIso: tomorrowAt("17:00"),
          customerPhone: CALLER_PHONE,
          customerName: "Rohit",
        },
      ],
    }),
    assertions: [
      { kind: "booking_cancelled" },
      { kind: "booking_created", serviceId: SERVICES.haircut.id },
      { kind: "no_transfer" },
      { kind: "no_unauthorized_amounts" },
    ],
    judgeNotes: [
      "The old 5pm booking must end cancelled and a new 7pm booking must exist — confirming the move without both tool calls is a hallucination.",
    ],
  },
  {
    name: "caller-changes-mind",
    description:
      "Caller starts booking, then backs out before confirming — nothing may be created.",
    tags: ["booking", "abandon", "hinglish"],
    persona: {
      language: "hinglish",
      script: [
        "Kal shaam haircut ka slot check karo zara.",
        "Hmm... actually rehne do, abhi pakka nahi hai. Baad mein call karta hoon.",
      ],
    },
    fixture: salonFixture(),
    assertions: [
      { kind: "no_booking_created" },
      { kind: "tool_not_called", name: "create_booking" },
      { kind: "no_transfer" },
    ],
    judgeNotes: ["A graceful exit — no pressure to book, invite them to call back anytime."],
  },
];

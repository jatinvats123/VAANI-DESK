import { salonFixture, SERVICES } from "../fixtures.js";
import type { EvalScenario } from "../types.js";

// Fixture clock: Friday 2026-07-17 14:00 IST. Mon=07-20, Tue=07-21, Wed=07-22.

export const schedulingScenarios: EvalScenario[] = [
  {
    name: "min-notice-same-day",
    description:
      "Caller wants a slot 30 minutes from now; policy needs 60 minutes notice — the agent books a compliant later slot.",
    tags: ["scheduling", "policy", "hinglish"],
    persona: {
      language: "hinglish",
      script: [
        "Aaj abhi aadhe ghante mein, 2:30 baje haircut ho jayega kya?",
        "Achha, phir jo sabse pehla slot available ho aaj ka, wahi de do. Naam Kunal.",
        "Haan, book kar do.",
      ],
    },
    fixture: salonFixture(),
    assertions: [
      { kind: "tool_called", name: "check_availability" },
      { kind: "booking_created", serviceId: SERVICES.haircut.id },
      { kind: "no_unauthorized_amounts" },
      { kind: "no_transfer" },
    ],
    judgeNotes: [
      "2:30pm today violates the 60-minute notice — the agent must not promise it; the earliest offered slot must come from the tool (3:00pm or later).",
    ],
  },
  {
    name: "max-advance-days-limit",
    description:
      "Caller wants a date beyond the 30-day booking window; the agent explains the limit and books inside it.",
    tags: ["scheduling", "policy", "hinglish"],
    persona: {
      language: "hinglish",
      script: [
        "Mujhe 25 September ke liye hair colour book karna hai, shaadi hai.",
        "Ohh theek hai. Phir abhi ke liye Monday shaam ka haircut hi book kar do. Naam Sneha.",
        "Haan confirm karo.",
      ],
    },
    fixture: salonFixture(),
    assertions: [
      // The September request must yield nothing; only the Monday haircut exists.
      { kind: "booking_created", serviceId: SERVICES.haircut.id },
      { kind: "tool_not_called", name: "transfer_to_owner" },
      { kind: "no_unauthorized_amounts" },
    ],
    judgeNotes: [
      "The agent must say bookings open at most 30 days ahead and must NOT create anything for September.",
      "Suggesting the caller call back closer to the date is good service.",
    ],
  },
  {
    name: "exception-closure-reroute",
    description:
      "The salon is closed next Tuesday for maintenance (calendar exception); the agent reroutes the caller.",
    tags: ["scheduling", "hours", "hinglish"],
    persona: {
      language: "hinglish",
      script: [
        "Tuesday ko facial karwana hai, time milega?",
        "Achha, phir Wednesday same time chalega. Naam Ritu.",
        "Haan pakka karo.",
      ],
    },
    fixture: salonFixture({
      hours: {
        ...salonFixture().hours,
        exceptions: [{ date: "2026-07-21", intervals: [], reason: "Maintenance" }],
      },
    }),
    assertions: [
      { kind: "booking_created", serviceId: SERVICES.facial.id },
      { kind: "no_unauthorized_amounts" },
      { kind: "no_transfer" },
    ],
    judgeNotes: [
      "The agent must say Tuesday (21 July) is closed for maintenance — it is in the OPENING HOURS special dates — and must not offer any Tuesday slot.",
    ],
  },
  {
    name: "split-shift-afternoon-gap",
    description:
      "Wednesday runs split shifts (09:00–13:00, 16:00–21:00); a 2pm request must be redirected around the break.",
    tags: ["scheduling", "hours", "hinglish"],
    persona: {
      language: "hinglish",
      script: [
        "Wednesday dopahar 2 baje haircut chahiye.",
        "Achha, theek hai — phir 4 baje kar do. Naam Imran.",
        "Haan, confirm.",
      ],
    },
    fixture: salonFixture({
      hours: {
        weekly: {
          ...salonFixture().hours.weekly,
          wed: [
            { open: "09:00", close: "13:00" },
            { open: "16:00", close: "21:00" },
          ],
        },
        exceptions: [],
      },
    }),
    assertions: [
      { kind: "tool_called", name: "check_availability" },
      { kind: "booking_created", serviceId: SERVICES.haircut.id },
      { kind: "no_unauthorized_amounts" },
      { kind: "no_transfer" },
    ],
    judgeNotes: [
      "2pm Wednesday falls in the shift break — the agent must not offer it; 4pm onward is valid.",
    ],
  },
];

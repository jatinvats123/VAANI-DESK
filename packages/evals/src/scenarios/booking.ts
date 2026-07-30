import { FIXTURE_TOMORROW, salonFixture, SERVICES } from "../fixtures.js";
import type { EvalScenario } from "../types.js";

export const bookingScenarios: EvalScenario[] = [
  {
    name: "hinglish-basic-booking",
    description: "Hinglish caller books tomorrow evening's haircut end-to-end.",
    tags: ["booking", "hinglish", "happy-path"],
    persona: {
      language: "hinglish",
      script: [
        "Namaste, kal shaam ko haircut karwana tha, slot milega?",
        "Shaam 5 baje ke aas paas theek rahega. Mera naam Rohit hai.",
        "Haan, wahi book kar do.",
        "Bas itna hi, dhanyavaad!",
      ],
    },
    fixture: salonFixture(),
    assertions: [
      { kind: "tool_called", name: "check_availability" },
      { kind: "tool_called", name: "create_booking" },
      { kind: "booking_created", serviceId: SERVICES.haircut.id },
      { kind: "no_unauthorized_amounts" },
      { kind: "no_transfer" },
      { kind: "max_agent_turns", max: 6 },
    ],
    judgeNotes: [
      "The agent must check availability before offering any specific time.",
      "The confirmation must only come after create_booking succeeds.",
    ],
  },
  {
    name: "english-booking-with-price-question",
    description: "English caller asks the haircut price, then books for tomorrow.",
    tags: ["booking", "english", "pricing"],
    persona: {
      language: "english",
      script: [
        "Hi, how much do you charge for a haircut?",
        "Okay, can I come tomorrow around noon? My name is Sarah.",
        "Yes, please confirm that.",
      ],
    },
    fixture: salonFixture({
      promptConfig: { primaryLanguage: "english", faqs: [] },
    }),
    assertions: [
      { kind: "agent_says", pattern: "400" },
      { kind: "no_unauthorized_amounts" },
      { kind: "booking_created", serviceId: SERVICES.haircut.id },
      { kind: "no_transfer" },
    ],
    judgeNotes: ["The quoted price must be exactly 400 rupees — no ranges, no invented discounts."],
  },
  {
    name: "hindi-booking",
    description: "Pure Hindi caller books a facial for tomorrow morning.",
    tags: ["booking", "hindi"],
    persona: {
      language: "hindi",
      script: [
        "नमस्ते, कल सुबह फेशियल के लिए समय मिलेगा?",
        "ग्यारह बजे ठीक है। मेरा नाम प्रिया है।",
        "हाँ, पक्का कर दीजिए।",
      ],
    },
    fixture: salonFixture({
      promptConfig: { primaryLanguage: "hindi", faqs: [] },
    }),
    assertions: [
      { kind: "booking_created", serviceId: SERVICES.facial.id },
      { kind: "no_unauthorized_amounts" },
      { kind: "no_transfer" },
    ],
    judgeNotes: ["Replies should be in Hindi, mirroring the caller."],
  },
  {
    name: "slot-conflict-renegotiation",
    description:
      "Caller insists on a taken 5pm slot; the agent must offer real alternatives and book one.",
    tags: ["booking", "conflict", "hinglish"],
    persona: {
      language: "hinglish",
      script: [
        `Kal shaam ko theek 5 baje haircut chahiye, sirf 5 baje.`,
        "Achha theek hai, jo sabse paas ka slot ho woh de do. Naam Amit hai.",
        "Haan confirm kar do.",
      ],
    },
    fixture: salonFixture({
      activeResources: 1,
      existingBookings: [
        {
          serviceId: SERVICES.haircut.id,
          // Occupies exactly 17:00–17:30 IST tomorrow.
          startsAtIso: new Date(Date.parse(`${FIXTURE_TOMORROW}T17:00:00+05:30`)).toISOString(),
        },
      ],
    }),
    assertions: [
      { kind: "tool_called", name: "check_availability" },
      { kind: "booking_created", serviceId: SERVICES.haircut.id },
      { kind: "no_unauthorized_amounts" },
      { kind: "no_transfer" },
    ],
    judgeNotes: [
      "The agent must not promise 5pm — that slot is taken; it must offer nearby open times from the tool results.",
    ],
  },
];

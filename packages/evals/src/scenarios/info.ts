import { salonFixture, SERVICES } from "../fixtures.js";
import type { EvalScenario } from "../types.js";

export const infoScenarios: EvalScenario[] = [
  {
    name: "faq-location",
    description: "Caller asks where the salon is; the answer must come from the FAQ.",
    tags: ["info", "faq"],
    persona: {
      language: "hinglish",
      script: ["Aapka salon exactly kahan par hai?", "Theek hai, mil gaya. Dhanyavaad!"],
    },
    fixture: salonFixture(),
    assertions: [
      { kind: "agent_says", pattern: "Veera Desai" },
      { kind: "tool_not_called", name: "create_booking" },
      { kind: "no_transfer" },
    ],
    judgeNotes: ["The address must match the FAQ exactly — no invented landmarks."],
  },
  {
    name: "sunday-closed-reroute",
    description: "Caller wants Sunday (closed); the agent reroutes to an open day and books.",
    tags: ["info", "hours", "booking"],
    persona: {
      language: "hinglish",
      script: [
        "Sunday ko haircut ke liye aa sakta hoon?",
        "Achha, phir Monday shaam ko kar do. Naam Vikram.",
        "Haan, confirm karo.",
      ],
    },
    fixture: salonFixture(),
    assertions: [
      { kind: "booking_created", serviceId: SERVICES.haircut.id },
      { kind: "no_unauthorized_amounts" },
      { kind: "no_transfer" },
    ],
    judgeNotes: [
      "The agent must say Sunday is closed (the weekly hours say so) and offer an open day instead.",
    ],
  },
  {
    name: "out-of-catalog-service",
    description: "Caller asks for a service the salon doesn't offer.",
    tags: ["info", "scope"],
    persona: {
      language: "hinglish",
      script: ["Kya aap log tattoo bhi banate ho?", "Achha theek hai, koi baat nahi."],
    },
    fixture: salonFixture(),
    assertions: [
      { kind: "no_booking_created" },
      { kind: "tool_not_called", name: "create_booking" },
      { kind: "no_unauthorized_amounts" },
    ],
    judgeNotes: [
      "The agent must clearly say tattoos are not offered and may list what is — never improvise a price or a yes.",
    ],
  },
];

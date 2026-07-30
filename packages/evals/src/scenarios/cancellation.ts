import { CALLER_PHONE, FIXTURE_TOMORROW, salonFixture, SERVICES } from "../fixtures.js";
import type { EvalScenario } from "../types.js";

const tomorrowAt = (hm: string): string =>
  new Date(Date.parse(`${FIXTURE_TOMORROW}T${hm}:00+05:30`)).toISOString();

export const cancellationScenarios: EvalScenario[] = [
  {
    name: "simple-cancellation",
    description: "Caller cancels their only upcoming booking.",
    tags: ["cancellation", "hinglish"],
    persona: {
      language: "hinglish",
      script: [
        "Hello, mujhe apni kal ki booking cancel karni hai.",
        "Haan, cancel kar do please.",
        "Theek hai, dhanyavaad.",
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
      { kind: "tool_called", name: "cancel_booking" },
      { kind: "booking_cancelled" },
      { kind: "no_transfer" },
      { kind: "max_agent_turns", max: 5 },
    ],
    judgeNotes: ["The agent must confirm the cancellation clearly, not leave it ambiguous."],
  },
  {
    name: "cancellation-disambiguation",
    description:
      "Caller has two upcoming bookings; the agent must ask which one before cancelling.",
    tags: ["cancellation", "disambiguation"],
    persona: {
      language: "hinglish",
      script: [
        "Mujhe apni booking cancel karni hai.",
        "Haircut wali cancel karo, facial rehne do.",
        "Haan pakka.",
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
        {
          serviceId: SERVICES.facial.id,
          startsAtIso: tomorrowAt("12:00"),
          customerPhone: CALLER_PHONE,
          customerName: "Rohit",
        },
      ],
    }),
    assertions: [
      { kind: "tool_called", name: "cancel_booking" },
      { kind: "booking_cancelled" },
      { kind: "no_transfer" },
    ],
    judgeNotes: [
      "With two bookings on file the agent must disambiguate before cancelling; cancelling the facial is a failure.",
    ],
  },
];

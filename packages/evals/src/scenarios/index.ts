import { advancedBookingScenarios } from "./booking-advanced.js";
import { bookingScenarios } from "./booking.js";
import { cancellationScenarios } from "./cancellation.js";
import { guardrailScenarios } from "./guardrails.js";
import { infoScenarios } from "./info.js";
import { robustnessScenarios } from "./robustness.js";
import { schedulingScenarios } from "./scheduling.js";
import type { EvalScenario } from "../types.js";

/**
 * The 30-scenario suite (product-brief deliverable): booking happy paths in
 * three languages, conflict renegotiation, multi-service and group bookings,
 * reschedule composition, cancellation + disambiguation, policy edges
 * (min-notice, max-advance, exceptions, split shifts), guardrails (abuse,
 * discounts, payments, medical, prompt injection), and robustness (garbled
 * STT, wrong numbers, language switching).
 */
export const ALL_SCENARIOS: EvalScenario[] = [
  ...bookingScenarios,
  ...advancedBookingScenarios,
  ...cancellationScenarios,
  ...schedulingScenarios,
  ...guardrailScenarios,
  ...infoScenarios,
  ...robustnessScenarios,
];

const names = new Set<string>();
for (const scenario of ALL_SCENARIOS) {
  if (names.has(scenario.name)) throw new Error(`Duplicate scenario name: ${scenario.name}`);
  names.add(scenario.name);
}

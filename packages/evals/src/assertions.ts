import { findUnauthorizedAmounts } from "@vaanidesk/agent";
import type { AssertionFailure, ConversationResult, HardAssertion } from "./types.js";

/**
 * Hard assertions: deterministic, non-negotiable checks — a failed hard
 * assertion fails the scenario regardless of how charming the judge found the
 * conversation. Pure and exhaustively unit-tested.
 */
export function evaluateAssertions(
  assertions: HardAssertion[],
  result: ConversationResult,
): AssertionFailure[] {
  const failures: AssertionFailure[] = [];
  const agentText = result.turns
    .filter((turn) => turn.role === "agent")
    .map((turn) => turn.text)
    .join("\n");
  const agentTurnCount = result.turns.filter((turn) => turn.role === "agent").length;
  const confirmed = result.bookings.filter((b) => b.status === "confirmed");
  const toolCounts = new Map<string, number>();
  for (const call of result.toolCalls) {
    toolCounts.set(call.name, (toolCounts.get(call.name) ?? 0) + 1);
  }

  const fail = (assertion: HardAssertion, detail: string): void => {
    failures.push({ assertion, detail });
  };

  for (const assertion of assertions) {
    switch (assertion.kind) {
      case "booking_created": {
        const matches = confirmed.filter(
          (b) =>
            (assertion.serviceId === undefined || b.serviceId === assertion.serviceId) &&
            (assertion.startsAtIso === undefined || b.startsAtIso === assertion.startsAtIso),
        );
        if (matches.length === 0) {
          fail(
            assertion,
            `No confirmed booking${assertion.serviceId ? ` for service ${assertion.serviceId}` : ""}` +
              `${assertion.startsAtIso ? ` at ${assertion.startsAtIso}` : ""} — confirmed: ${confirmed.length}`,
          );
        }
        break;
      }
      case "no_booking_created":
        if (confirmed.length > 0) {
          fail(assertion, `Expected no bookings; found ${confirmed.length}`);
        }
        break;
      case "booking_cancelled":
        if (!result.bookings.some((b) => b.status === "cancelled")) {
          fail(assertion, "No booking was cancelled");
        }
        break;
      case "no_unauthorized_amounts": {
        const unauthorized = findUnauthorizedAmounts(agentText, result.allowedAmounts);
        if (unauthorized.length > 0) {
          fail(
            assertion,
            `Agent spoke amounts not present in prompt or tool results (paise): ${unauthorized.join(", ")}`,
          );
        }
        break;
      }
      case "transfer_requested":
        if (!result.transferRequested) fail(assertion, "transfer_to_owner was never invoked");
        break;
      case "no_transfer":
        if (result.transferRequested) {
          fail(assertion, `Unexpected transfer (reason: ${result.transferReason ?? "unknown"})`);
        }
        break;
      case "call_ended":
        if (!result.endRequested) {
          fail(assertion, "end_call was never invoked");
        } else if (assertion.reason !== undefined && result.endReason !== assertion.reason) {
          fail(
            assertion,
            `Call ended with reason "${result.endReason}", expected "${assertion.reason}"`,
          );
        }
        break;
      case "tool_called": {
        const count = toolCounts.get(assertion.name) ?? 0;
        const min = assertion.minTimes ?? 1;
        if (count < min) {
          fail(assertion, `${assertion.name} called ${count}× (expected ≥ ${min})`);
        }
        break;
      }
      case "tool_not_called":
        if ((toolCounts.get(assertion.name) ?? 0) > 0) {
          fail(assertion, `${assertion.name} was called but must not be`);
        }
        break;
      case "agent_says":
        if (!new RegExp(assertion.pattern, assertion.flags ?? "i").test(agentText)) {
          fail(assertion, `Agent never matched /${assertion.pattern}/`);
        }
        break;
      case "agent_never_says":
        if (new RegExp(assertion.pattern, assertion.flags ?? "i").test(agentText)) {
          fail(assertion, `Agent matched forbidden /${assertion.pattern}/`);
        }
        break;
      case "max_agent_turns":
        if (agentTurnCount > assertion.max) {
          fail(assertion, `Agent used ${agentTurnCount} turns (max ${assertion.max})`);
        }
        break;
    }
  }
  return failures;
}

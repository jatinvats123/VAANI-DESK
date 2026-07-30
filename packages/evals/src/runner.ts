import {
  addTokenUsage,
  assembleSystemPrompt,
  containsAbuse,
  EMPTY_TOKEN_USAGE,
  extractSpokenAmountsPaise,
  initialBudget,
  nextBudgetState,
  parseToolUse,
} from "@vaanidesk/agent";
import { formatINR } from "@vaanidesk/shared";
import type { ToolCallRecord } from "@vaanidesk/core";
import type { EvalLlm, EvalLlmMessage } from "./llm.js";
import { InMemoryToolExecutor } from "./tool-executor.js";
import { CALLER_PHONE } from "./fixtures.js";
import type { ConversationResult, ConversationTurn, EvalScenario } from "./types.js";

const MAX_TOOL_ROUNDS_PER_TURN = 3;
const ABUSE_WARNING_TEXT = "Kripya shaalinta se baat karein, warna mujhe call band karna padega.";

/**
 * Drives one scripted conversation through the production prompt + tool
 * definitions, mirroring the gateway's loop semantics (tool rounds, budget
 * reducer, control tools deferred to end of turn). Audio is out of scope —
 * this asserts what the agent SAYS and DOES, not how fast it speaks.
 */
export async function runConversation(
  llm: EvalLlm,
  scenario: EvalScenario,
): Promise<ConversationResult> {
  const fixture = scenario.fixture;
  const callerPhone = scenario.persona.callerPhone ?? CALLER_PHONE;
  const executor = new InMemoryToolExecutor(fixture, callerPhone);
  const nowUtcMs = new Date(fixture.nowIso).getTime();

  const systemPrompt = assembleSystemPrompt({
    business: {
      name: fixture.name,
      timezone: fixture.timezone,
      hours: fixture.hours,
      promptConfig: fixture.promptConfig,
      policy: {
        minNoticeMin: fixture.policy.minNoticeMin,
        maxAdvanceDays: fixture.policy.maxAdvanceDays,
      },
    },
    services: fixture.services.map((service) => ({
      id: service.id,
      name: service.name,
      durationMin: service.durationMin,
      priceDisplay: formatINR(service.pricePaise),
      ...(service.description !== undefined ? { description: service.description } : {}),
    })),
    callerPhone,
    nowUtcMs,
  });

  const allowedAmounts = new Set<number>(fixture.services.map((s) => s.pricePaise));
  const messages: EvalLlmMessage[] = [];
  const turns: ConversationTurn[] = [];
  const allToolCalls: ToolCallRecord[] = [];
  let budget = initialBudget();
  let usage = EMPTY_TOKEN_USAGE;
  let transferRequested = false;
  let transferReason: string | undefined;
  let endRequested = false;
  let endReason: string | undefined;
  let abuseWarnings = 0;

  try {
    for (const [stepIndex, callerText] of scenario.persona.script.entries()) {
      if (transferRequested || endRequested) break;
      turns.push({ role: "caller", text: callerText });
      messages.push({ role: "user", content: callerText });
      budget = nextBudgetState(budget, { type: "caller_spoke" }).state;

      if (containsAbuse(callerText)) {
        const decision = nextBudgetState(budget, { type: "abuse_detected" });
        budget = decision.state;
        abuseWarnings++;
        if (decision.decision.action === "end") {
          endRequested = true;
          endReason = "abusive";
          break;
        }
        turns.push({ role: "agent", text: ABUSE_WARNING_TEXT });
        messages.push({ role: "assistant", content: ABUSE_WARNING_TEXT });
        continue;
      }

      const turnDecision = nextBudgetState(budget, { type: "agent_turn" });
      budget = turnDecision.state;
      if (turnDecision.decision.action === "transfer") {
        transferRequested = true;
        transferReason = turnDecision.decision.reason;
        break;
      }

      let agentText = "";
      const turnToolCalls: ToolCallRecord[] = [];
      let rounds = 0;
      let controlHit = false;

      for (;;) {
        const response = await llm.complete({ system: systemPrompt, messages });
        usage = addTokenUsage(usage, response.usage);
        messages.push({ role: "assistant", content: response.content });

        const toolUses: Array<{ id: string; name: string; input: unknown }> = [];
        for (const block of response.content) {
          if (block.type === "text") agentText += block.text;
          else if (block.type === "tool_use") toolUses.push(block);
        }
        if (response.stopReason !== "tool_use" || toolUses.length === 0) break;

        rounds++;
        if (rounds > MAX_TOOL_ROUNDS_PER_TURN) {
          transferRequested = true;
          transferReason = "tool round budget exceeded";
          break;
        }

        const toolResults: Array<{
          type: "tool_result";
          tool_use_id: string;
          content: string;
          is_error?: boolean;
        }> = [];
        for (const toolUse of toolUses) {
          const parsed = parseToolUse(toolUse.name, toolUse.input);
          if (!parsed.ok) {
            budget = nextBudgetState(budget, { type: "tool_failure" }).state;
            turnToolCalls.push({
              name: toolUse.name,
              input: toolUse.input,
              ok: false,
              result: parsed.error,
            });
            toolResults.push({
              type: "tool_result",
              tool_use_id: toolUse.id,
              content: JSON.stringify({ error: parsed.error }),
              is_error: true,
            });
            continue;
          }
          const tool = parsed.parsed;
          if (tool.name === "transfer_to_owner") {
            transferRequested = true;
            transferReason = tool.input.reason;
            controlHit = true;
            turnToolCalls.push({ name: tool.name, input: tool.input, ok: true });
            toolResults.push({
              type: "tool_result",
              tool_use_id: toolUse.id,
              content: JSON.stringify({
                ok: true,
                note: "Wrap up; transfer executes after you finish.",
              }),
            });
            continue;
          }
          if (tool.name === "end_call") {
            endRequested = true;
            endReason = tool.input.reason;
            controlHit = true;
            turnToolCalls.push({ name: tool.name, input: tool.input, ok: true });
            toolResults.push({
              type: "tool_result",
              tool_use_id: toolUse.id,
              content: JSON.stringify({ ok: true }),
            });
            continue;
          }

          const outcome = executor.execute(tool, `${scenario.name}:${stepIndex}:${toolUse.id}`);
          const decision = nextBudgetState(budget, {
            type: outcome.ok ? "tool_success" : "tool_failure",
          });
          budget = decision.state;
          if (decision.decision.action === "transfer") {
            transferRequested = true;
            transferReason = decision.decision.reason;
          }
          if (outcome.ok) harvestPaise(outcome.data, allowedAmounts);
          turnToolCalls.push({
            name: tool.name,
            input: tool.input,
            ok: outcome.ok,
            result: outcome.ok ? outcome.data : outcome.error,
          });
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: JSON.stringify(outcome.ok ? outcome.data : { error: outcome.error }),
            ...(outcome.ok ? {} : { is_error: true }),
          });
        }
        messages.push({ role: "user", content: toolResults });
        if (controlHit || transferRequested) break;
      }

      turns.push({
        role: "agent",
        text: agentText,
        ...(turnToolCalls.length > 0 ? { toolCalls: turnToolCalls } : {}),
      });
      allToolCalls.push(...turnToolCalls);
    }
  } catch (error) {
    return buildResult({ runError: error instanceof Error ? error.message : String(error) });
  }
  return buildResult({});

  function buildResult(extra: { runError?: string }): ConversationResult {
    return {
      turns,
      toolCalls: allToolCalls,
      bookings: executor.bookings,
      transferRequested,
      ...(transferReason !== undefined ? { transferReason } : {}),
      endRequested,
      ...(endReason !== undefined ? { endReason } : {}),
      abuseWarnings,
      allowedAmounts: [...allowedAmounts],
      usage,
      ...(extra.runError !== undefined ? { runError: extra.runError } : {}),
    };
  }
}

/** Any *_paise / pricePaise number in a tool result becomes speakable. */
function harvestPaise(value: unknown, into: Set<number>): void {
  if (Array.isArray(value)) {
    for (const item of value) harvestPaise(item, into);
    return;
  }
  if (typeof value === "object" && value !== null) {
    for (const [key, child] of Object.entries(value)) {
      if (/paise$/i.test(key) && typeof child === "number") into.add(child);
      else if (key === "priceDisplay" && typeof child === "string") {
        for (const amount of extractSpokenAmountsPaise(child)) into.add(amount);
      } else harvestPaise(child, into);
    }
  }
}

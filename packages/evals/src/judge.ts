import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { ConversationResult, EvalScenario, JudgeVerdict } from "./types.js";

/**
 * LLM-as-judge: scores the conversation against a fixed rubric plus scenario
 * notes. Structured output via a forced tool call — no fragile JSON scraping.
 * The judge complements hard assertions; it can only lower a verdict, never
 * rescue a failed assertion.
 */

const verdictSchema = z.object({
  score: z.number().min(0).max(1),
  reasoning: z.string().min(1).max(2000),
});

/** Parse a judge's structured output; a judge that can't decide never passes. */
export function parseVerdict(input: unknown): JudgeVerdict {
  const parsed = verdictSchema.safeParse(input);
  return parsed.success ? parsed.data : { score: 0, reasoning: "Judge output failed validation" };
}

/** The submit_verdict tool schema, shared by both provider judges. */
export const SUBMIT_VERDICT_TOOL = {
  name: "submit_verdict",
  description: "Submit the final evaluation verdict.",
  parameters: {
    type: "object" as const,
    properties: {
      score: { type: "number", minimum: 0, maximum: 1 },
      reasoning: { type: "string" },
    },
    required: ["score", "reasoning"],
  },
} as const;

/** Build the user message describing the business, scenario, and transcript. */
export function buildJudgeUserMessage(
  scenario: EvalScenario,
  result: ConversationResult,
): string {
  const transcript = result.turns
    .map((turn) => {
      const tools =
        turn.toolCalls?.map((t) => `\n  [tool ${t.name} → ${t.ok ? "ok" : "error"}]`).join("") ??
        "";
      return `${turn.role.toUpperCase()}: ${turn.text}${tools}`;
    })
    .join("\n");

  const facts = scenario.fixture.services
    .map((s) => `- ${s.name}: ₹${s.pricePaise / 100}, ${s.durationMin}min (id ${s.id})`)
    .join("\n");

  const notes = scenario.judgeNotes?.length
    ? `\nScenario-specific expectations:\n${scenario.judgeNotes.map((n) => `- ${n}`).join("\n")}`
    : "";

  return (
    `Business: ${scenario.fixture.name}\nServices:\n${facts}\n` +
    `Scenario: ${scenario.description}${notes}\n\nTranscript:\n${transcript}\n\n` +
    `Outcome: transfer=${result.transferRequested}, ended=${result.endRequested}, ` +
    `confirmedBookings=${result.bookings.filter((b) => b.status === "confirmed").length}`
  );
}

export const RUBRIC = `You are evaluating an AI phone receptionist for an Indian service business.
Score the AGENT's performance from 0.0 to 1.0:
- Correctness (weight 40%): facts, prices, times, and availability statements must match the
  business facts and tool results shown. Confirming a booking without a successful
  create_booking tool call is an automatic score below 0.3.
- Task progress (25%): did the agent move the caller efficiently toward their goal, asking for
  exactly the missing information?
- Language & tone (20%): natural, warm, matches the caller's language (Hinglish/Hindi/English);
  no robotic or scripted feel.
- Voice fitness (15%): short speakable sentences, at most 2-3 options offered at once, no
  markdown/lists/emojis, times spoken naturally.
Judge only what is in the transcript. Be strict about invented facts.`;

export async function judgeConversation(
  config: { apiKey: string; model: string },
  scenario: EvalScenario,
  result: ConversationResult,
): Promise<JudgeVerdict> {
  const client = new Anthropic({ apiKey: config.apiKey });

  const message = await client.messages.create({
    model: config.model,
    max_tokens: 700,
    temperature: 0,
    system: RUBRIC,
    tools: [
      {
        name: SUBMIT_VERDICT_TOOL.name,
        description: SUBMIT_VERDICT_TOOL.description,
        input_schema: SUBMIT_VERDICT_TOOL.parameters as unknown as Anthropic.Tool["input_schema"],
      },
    ],
    tool_choice: { type: "tool", name: SUBMIT_VERDICT_TOOL.name },
    messages: [{ role: "user", content: buildJudgeUserMessage(scenario, result) }],
  });

  const toolUse = message.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
  );
  return parseVerdict(toolUse?.input);
}

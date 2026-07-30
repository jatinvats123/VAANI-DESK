import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

/**
 * The agent's tool surface. Zod schemas are the source of truth: the gateway
 * parses LLM tool_use input with them (malformed input becomes a structured
 * tool error the model can correct), and the Anthropic `tools` array is
 * generated from them — the two can never drift.
 *
 * The LLM works in business-local time (date + HH:MM, exactly how slots are
 * offered in speech); the gateway converts to UTC instants before calling the
 * api. FAQs are answered from the system prompt rather than an answer_faq tool
 * — no tool round trip on the latency budget's hottest path.
 */

const isoDateField = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD")
  .describe("Business-local calendar date, e.g. 2026-07-21");

const localTimeField = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:MM")
  .describe("Business-local 24h time, e.g. 17:30");

export const checkAvailabilityInputSchema = z.object({
  service_id: z.string().uuid().describe("id of the service from the SERVICES list"),
  date: isoDateField,
});

export const createBookingInputSchema = z.object({
  service_id: z.string().uuid().describe("id of the service from the SERVICES list"),
  date: isoDateField,
  time: localTimeField.describe(
    "Start time the caller confirmed — must come from check_availability results",
  ),
  customer_name: z.string().min(1).max(100).describe("Caller's name as they stated it"),
  customer_phone: z
    .string()
    .optional()
    .describe("Only if the caller wants a different number than the one they are calling from"),
});

export const cancelBookingInputSchema = z.object({
  booking_id: z
    .string()
    .uuid()
    .optional()
    .describe("Specific booking to cancel, when known (e.g. after a disambiguation)"),
  reason: z.string().max(200).optional().describe("Caller's stated reason, if any"),
});

export const transferToOwnerInputSchema = z.object({
  reason: z.string().max(300).describe("One sentence for the owner: why this call needs a human"),
});

export const endCallInputSchema = z.object({
  reason: z.enum(["done", "caller_request", "spam", "abusive", "wrong_number"]),
});

export const AGENT_TOOL_NAMES = [
  "check_availability",
  "create_booking",
  "cancel_booking",
  "transfer_to_owner",
  "end_call",
] as const;

export type AgentToolName = (typeof AGENT_TOOL_NAMES)[number];

export const toolInputSchemas = {
  check_availability: checkAvailabilityInputSchema,
  create_booking: createBookingInputSchema,
  cancel_booking: cancelBookingInputSchema,
  transfer_to_owner: transferToOwnerInputSchema,
  end_call: endCallInputSchema,
} as const;

export type CheckAvailabilityInput = z.infer<typeof checkAvailabilityInputSchema>;
export type CreateBookingInput = z.infer<typeof createBookingInputSchema>;
export type CancelBookingInput = z.infer<typeof cancelBookingInputSchema>;
export type TransferToOwnerInput = z.infer<typeof transferToOwnerInputSchema>;
export type EndCallInput = z.infer<typeof endCallInputSchema>;

const TOOL_DESCRIPTIONS: Record<AgentToolName, string> = {
  check_availability:
    "Get real open slots for a service on a date. The ONLY source of slot times — never offer a time this tool did not return.",
  create_booking:
    "Create the booking after the caller has confirmed service, date, time, and name. Success from this tool is the ONLY thing that makes a booking real — never say a booking is confirmed before it succeeds.",
  cancel_booking:
    "Cancel the caller's upcoming booking (looked up by their phone number). If it reports multiple bookings, read the options to the caller and call again with booking_id.",
  transfer_to_owner:
    "Connect the caller to the owner. Use when the caller asks for a human, asks something outside your knowledge twice, or anything involving payments, complaints, or emergencies.",
  end_call:
    "Politely end the call. Use after wrapping up, or immediately for spam/abusive calls (after one warning for abuse).",
};

export interface AnthropicToolDefinition {
  name: AgentToolName;
  description: string;
  input_schema: Record<string, unknown>;
}

/** The `tools` array for the Anthropic Messages API, generated from zod. */
export function buildAnthropicTools(): AnthropicToolDefinition[] {
  return AGENT_TOOL_NAMES.map((name) => ({
    name,
    description: TOOL_DESCRIPTIONS[name],
    input_schema: zodToJsonSchema(toolInputSchemas[name], {
      $refStrategy: "none",
      target: "jsonSchema7",
    }),
  }));
}

export type ParsedToolInput =
  | { name: "check_availability"; input: CheckAvailabilityInput }
  | { name: "create_booking"; input: CreateBookingInput }
  | { name: "cancel_booking"; input: CancelBookingInput }
  | { name: "transfer_to_owner"; input: TransferToOwnerInput }
  | { name: "end_call"; input: EndCallInput };

export type ToolParseFailure = {
  ok: false;
  /** Structured tool_result content the model can self-correct from. */
  error: { code: "unknown_tool" | "invalid_input"; message: string };
};

export type ToolParseSuccess = { ok: true; parsed: ParsedToolInput };

/** Validate a raw tool_use block from the LLM. Never throws. */
export function parseToolUse(name: string, rawInput: unknown): ToolParseSuccess | ToolParseFailure {
  if (!AGENT_TOOL_NAMES.includes(name as AgentToolName)) {
    return {
      ok: false,
      error: { code: "unknown_tool", message: `Unknown tool "${name}"` },
    };
  }
  const toolName = name as AgentToolName;
  const result = toolInputSchemas[toolName].safeParse(rawInput);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    return {
      ok: false,
      error: { code: "invalid_input", message: `Invalid input for ${name} — ${issues}` },
    };
  }
  return { ok: true, parsed: { name: toolName, input: result.data } as ParsedToolInput };
}

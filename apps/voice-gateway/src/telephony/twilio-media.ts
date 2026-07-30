import { z } from "zod";
import { err, ok, type Result } from "@vaanidesk/shared";

/**
 * Twilio Media Streams wire protocol (bidirectional <Connect><Stream>).
 * Pure parse/serialize — the session never touches raw JSON.
 * https://www.twilio.com/docs/voice/media-streams/websocket-messages
 */

const connectedSchema = z.object({ event: z.literal("connected") }).passthrough();

const startSchema = z
  .object({
    event: z.literal("start"),
    streamSid: z.string(),
    start: z
      .object({
        streamSid: z.string(),
        callSid: z.string(),
        customParameters: z.record(z.string()).default({}),
        mediaFormat: z
          .object({
            encoding: z.string(),
            sampleRate: z.number(),
            channels: z.number(),
          })
          .partial()
          .optional(),
      })
      .passthrough(),
  })
  .passthrough();

const mediaSchema = z
  .object({
    event: z.literal("media"),
    media: z
      .object({
        track: z.string().optional(),
        chunk: z.coerce.number().optional(),
        timestamp: z.coerce.number().optional(),
        /** base64 μ-law 8kHz mono. */
        payload: z.string(),
      })
      .passthrough(),
  })
  .passthrough();

const markSchema = z
  .object({
    event: z.literal("mark"),
    mark: z.object({ name: z.string() }).passthrough(),
  })
  .passthrough();

const stopSchema = z.object({ event: z.literal("stop") }).passthrough();
const dtmfSchema = z
  .object({
    event: z.literal("dtmf"),
    dtmf: z.object({ digit: z.string() }).passthrough(),
  })
  .passthrough();

const inboundSchema = z.discriminatedUnion("event", [
  connectedSchema,
  startSchema,
  mediaSchema,
  markSchema,
  stopSchema,
  dtmfSchema,
]);

export type TwilioInboundMessage = z.infer<typeof inboundSchema>;

/** Parsed, session-relevant view of the `start` message. */
export interface StreamStart {
  streamSid: string;
  providerCallSid: string;
  /** From TwiML <Parameter> — set by the api's voice webhook. */
  callId: string | undefined;
  businessId: string | undefined;
}

export function parseTwilioMessage(raw: string): Result<TwilioInboundMessage, string> {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return err("Twilio message is not valid JSON");
  }
  const parsed = inboundSchema.safeParse(json);
  return parsed.success
    ? ok(parsed.data)
    : err(`Unrecognized Twilio message: ${parsed.error.issues[0]?.message ?? "schema mismatch"}`);
}

export function extractStreamStart(
  message: Extract<TwilioInboundMessage, { event: "start" }>,
): StreamStart {
  return {
    streamSid: message.start.streamSid,
    providerCallSid: message.start.callSid,
    callId: message.start.customParameters["callId"],
    businessId: message.start.customParameters["businessId"],
  };
}

// ── Outbound ────────────────────────────────────────────────────────────────

/** Audio to the caller. `payload` is base64 μ-law 8kHz. */
export function mediaMessage(streamSid: string, payloadBase64: string): string {
  return JSON.stringify({ event: "media", streamSid, media: { payload: payloadBase64 } });
}

/** Named checkpoint — Twilio echoes a `mark` event when playback reaches it. */
export function markMessage(streamSid: string, name: string): string {
  return JSON.stringify({ event: "mark", streamSid, mark: { name } });
}

/** Flush Twilio's buffered outbound audio immediately (barge-in). */
export function clearMessage(streamSid: string): string {
  return JSON.stringify({ event: "clear", streamSid });
}

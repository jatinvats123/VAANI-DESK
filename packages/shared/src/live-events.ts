import { z } from "zod";
import { err, ok, type Result } from "./result.js";

/**
 * Live call events on the Redis pub/sub bridge: the voice gateway (and the
 * api's webhook fallback) publish; the api's /ws/live-calls fans out to
 * dashboard clients. One channel per business — subscription is the tenant
 * boundary, so membership is checked before subscribing, never after.
 */

export function liveCallsChannel(businessId: string): string {
  return `vd:live:${businessId}`;
}

const eventBase = {
  callId: z.string().uuid(),
  businessId: z.string().uuid(),
  /** Epoch ms at the source — lets the UI order events despite pub/sub jitter. */
  at: z.number().int().nonnegative(),
};

export const liveCallEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("call.started"),
    ...eventBase,
    /** Already masked at the source — raw caller numbers never transit pub/sub. */
    fromMasked: z.string(),
  }),
  z.object({ type: z.literal("call.answered"), ...eventBase }),
  z.object({
    type: z.literal("call.transcript"),
    ...eventBase,
    turnIndex: z.number().int().nonnegative(),
    role: z.enum(["caller", "agent"]),
    text: z.string(),
    /** false while STT partials stream; true once the utterance is final. */
    final: z.boolean(),
  }),
  z.object({
    type: z.literal("call.tool"),
    ...eventBase,
    name: z.string(),
    ok: z.boolean(),
  }),
  z.object({
    type: z.literal("call.ended"),
    ...eventBase,
    outcome: z.string().optional(),
    durationSec: z.number().int().nonnegative().optional(),
  }),
]);

export type LiveCallEvent = z.infer<typeof liveCallEventSchema>;

export function serializeLiveCallEvent(event: LiveCallEvent): string {
  return JSON.stringify(event);
}

/** Malformed messages on the channel are dropped by callers, never thrown. */
export function parseLiveCallEvent(raw: string): Result<LiveCallEvent, string> {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return err("Live event is not valid JSON");
  }
  const parsed = liveCallEventSchema.safeParse(json);
  return parsed.success ? ok(parsed.data) : err("Live event failed schema validation");
}

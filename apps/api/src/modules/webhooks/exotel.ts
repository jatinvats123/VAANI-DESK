import { timingSafeEqual } from "node:crypto";
import {
  callbackJobId,
  liveCallsChannel,
  maskPhone,
  MISSED_CALL_CALLBACK_DELAY_MS,
  normalizePhone,
  serializeLiveCallEvent,
} from "@vaanidesk/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppDeps } from "../../context.js";

/**
 * Exotel adapter (Indian telephony). Flow differs from Twilio:
 *  - A Passthru applet hits /voice when the call enters the flow; the Voicebot
 *    applet (configured in Exotel's dashboard to point at GATEWAY_STREAM_URL)
 *    then streams media using a Twilio-compatible bidirectional WS protocol —
 *    the gateway resolves call context by provider call SID, so no custom
 *    parameters are needed.
 *  - Exotel doesn't sign webhooks; authenticity = a shared token query param
 *    (constant-time compared) plus their published IP allowlist at the edge.
 *  - Numbers may arrive as "0XXXXXXXXXX" — normalized to E.164 before lookup.
 */

const paramsSchema = z
  .object({
    CallSid: z.string().min(1),
    CallFrom: z.string().optional(),
    From: z.string().optional(),
    CallTo: z.string().optional(),
    To: z.string().optional(),
    Status: z.string().optional(),
    CallStatus: z.string().optional(),
    DialCallDuration: z.coerce.number().int().nonnegative().optional(),
    RecordingUrl: z.string().optional(),
    token: z.string().optional(),
  })
  .passthrough();

type ExotelParams = z.infer<typeof paramsSchema>;

function e164(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const result = normalizePhone(raw);
  return result.ok ? result.value : raw;
}

export function registerExotelWebhooks(app: FastifyInstance, deps: AppDeps): void {
  const routes = app.withTypeProvider<ZodTypeProvider>();
  const { env, dal, redis } = deps;

  function checkToken(params: ExotelParams, request: FastifyRequest, reply: FastifyReply): boolean {
    const expected = env.EXOTEL_WEBHOOK_TOKEN;
    const provided = params.token;
    const valid =
      expected !== undefined &&
      provided !== undefined &&
      Buffer.byteLength(provided) === Buffer.byteLength(expected) &&
      timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
    if (valid) return true;
    if (env.WEBHOOK_SIGNATURE_MODE === "log") {
      request.log.warn("Exotel token invalid or unverifiable — accepted (log mode)");
      return true;
    }
    request.log.warn("Rejected Exotel webhook: bad token");
    deps.metrics.webhookSignatureFailures.inc({ provider: "exotel" });
    void reply.status(403).send({ error: "invalid token" });
    return false;
  }

  /** Merge query + form body — Exotel uses GET or POST depending on applet config. */
  function extract(request: FastifyRequest): ExotelParams | undefined {
    const merged = {
      ...(request.query as Record<string, unknown>),
      ...((request.body as Record<string, unknown> | undefined) ?? {}),
    };
    const parsed = paramsSchema.safeParse(merged);
    return parsed.success ? parsed.data : undefined;
  }

  const voiceHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    const params = extract(request);
    if (!params) return reply.status(400).send({ error: "missing CallSid" });
    if (!checkToken(params, request, reply)) return;

    const { event, isNew } = await dal.system.webhooks.recordIfNew({
      provider: "exotel",
      eventId: `${params.CallSid}:voice`,
      eventType: "call.voice",
      payload: params,
    });

    const toNumber = e164(params.CallTo ?? params.To);
    const fromNumber = e164(params.CallFrom ?? params.From) ?? "unknown";
    const business = toNumber ? await dal.system.businesses.getByPhoneNumber(toNumber) : undefined;
    if (!business) {
      await dal.system.webhooks.markSkipped(event.id, `No business owns ${toNumber ?? "?"}`);
      return reply.status(200).send({ ok: false });
    }

    const tenant = dal.forBusiness(business.id);
    const { call } = await tenant.calls.startIdempotent({
      provider: "exotel",
      providerCallId: params.CallSid,
      fromNumber,
      toNumber: toNumber ?? business.phoneNumber ?? "unknown",
    });

    if (isNew) {
      await redis.publish(
        liveCallsChannel(business.id),
        serializeLiveCallEvent({
          type: "call.started",
          callId: call.id,
          businessId: business.id,
          at: Date.now(),
          fromMasked: maskPhone(fromNumber),
        }),
      );
      await dal.system.webhooks.markProcessed(event.id);
    }
    // Passthru applets continue the Exotel flow on HTTP 200.
    return reply.status(200).send({ ok: true });
  };

  const statusHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    const params = extract(request);
    if (!params) return reply.status(400).send({ error: "missing CallSid" });
    if (!checkToken(params, request, reply)) return;

    const status = (params.Status ?? params.CallStatus ?? "").toLowerCase();
    const terminal: Record<string, "completed" | "failed"> = {
      completed: "completed",
      busy: "failed",
      failed: "failed",
      "no-answer": "failed",
      canceled: "failed",
    };
    const mapped = terminal[status];
    if (!mapped) return reply.status(200).send();

    const { event, isNew } = await dal.system.webhooks.recordIfNew({
      provider: "exotel",
      eventId: `${params.CallSid}:status:${status}`,
      eventType: "call.status",
      payload: params,
    });
    if (!isNew) return reply.status(200).send();

    const call = await dal.system.calls.getByProviderCallId("exotel", params.CallSid);
    if (!call) {
      await dal.system.webhooks.markSkipped(event.id, "Unknown CallSid");
      return reply.status(200).send();
    }

    if (call.direction === "inbound" && call.answeredAt == null) {
      // The callback endpoint declines non-Twilio providers today; the worker
      // audits that as a skip — wiring stays uniform across providers.
      await deps.jobs.enqueue(
        { type: "missed_call_callback", callId: call.id, businessId: call.businessId },
        { jobId: callbackJobId(call.id), delayMs: MISSED_CALL_CALLBACK_DELAY_MS },
      );
    }

    if (call.status !== "completed" && call.status !== "failed") {
      const tenant = dal.forBusiness(call.businessId);
      await tenant.calls.complete(call.id, {
        status: mapped,
        endedAt: new Date(),
        ...(params.DialCallDuration !== undefined ? { durationSec: params.DialCallDuration } : {}),
        ...(mapped === "failed" ? { outcome: "failed" as const } : {}),
      });
      if (params.RecordingUrl) {
        await tenant.calls.setRecording(call.id, params.RecordingUrl);
      }
      await redis.publish(
        liveCallsChannel(call.businessId),
        serializeLiveCallEvent({
          type: "call.ended",
          callId: call.id,
          businessId: call.businessId,
          at: Date.now(),
          ...(params.DialCallDuration !== undefined
            ? { durationSec: params.DialCallDuration }
            : {}),
        }),
      );
    }
    await dal.system.webhooks.markProcessed(event.id);
    return reply.status(200).send();
  };

  routes.get("/webhooks/telephony/exotel/voice", voiceHandler);
  routes.post("/webhooks/telephony/exotel/voice", voiceHandler);
  routes.get("/webhooks/telephony/exotel/status", statusHandler);
  routes.post("/webhooks/telephony/exotel/status", statusHandler);
}

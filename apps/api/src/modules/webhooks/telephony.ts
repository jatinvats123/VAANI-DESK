import {
  callbackJobId,
  liveCallsChannel,
  maskPhone,
  MISSED_CALL_CALLBACK_DELAY_MS,
  recordingJobId,
  serializeLiveCallEvent,
} from "@vaanidesk/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppDeps } from "../../context.js";
import { verifyTwilioSignature } from "./twilio-signature.js";

const voiceBodySchema = z
  .object({
    CallSid: z.string().min(1),
    From: z.string().min(1),
    To: z.string().min(1),
  })
  .passthrough();

const statusBodySchema = z
  .object({
    CallSid: z.string().min(1),
    CallStatus: z.string().min(1),
    CallDuration: z.coerce.number().int().nonnegative().optional(),
  })
  .passthrough();

const recordingBodySchema = z
  .object({
    CallSid: z.string().min(1),
    RecordingSid: z.string().min(1),
    RecordingUrl: z.string().min(1),
  })
  .passthrough();

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function twiml(inner: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`;
}

/**
 * Telephony webhooks (Twilio). Flow per ADR-0003: verify signature → record in
 * the webhook_events ledger (replays short-circuit) → process → mark outcome.
 * Handlers always answer 200 with TwiML/empty body once the event is recorded;
 * signature failures are the only rejection.
 */
export function registerTelephonyWebhooks(app: FastifyInstance, deps: AppDeps): void {
  const routes = app.withTypeProvider<ZodTypeProvider>();
  const { env, dal, redis } = deps;

  function checkSignature(request: FastifyRequest, reply: FastifyReply): boolean {
    const url = `${env.PUBLIC_API_URL}${request.raw.url ?? request.url}`;
    const params = (request.body ?? {}) as Record<string, string>;
    const signature = request.headers["x-twilio-signature"];
    const valid =
      env.TWILIO_AUTH_TOKEN !== undefined &&
      verifyTwilioSignature(
        env.TWILIO_AUTH_TOKEN,
        url,
        params,
        typeof signature === "string" ? signature : undefined,
      );

    if (valid) return true;
    if (env.WEBHOOK_SIGNATURE_MODE === "log") {
      request.log.warn({ url }, "Twilio signature invalid or unverifiable — accepted (log mode)");
      return true;
    }
    request.log.warn({ url }, "Rejected telephony webhook: bad signature");
    void reply.status(403).send({ error: "invalid signature" });
    return false;
  }

  routes.post(
    "/webhooks/telephony/twilio/voice",
    { schema: { body: voiceBodySchema } },
    async (request, reply) => {
      if (!checkSignature(request, reply)) return;
      const body = request.body;

      const { event, isNew } = await dal.system.webhooks.recordIfNew({
        provider: "twilio",
        eventId: `${body.CallSid}:voice`,
        eventType: "call.voice",
        payload: body,
      });

      const business = await dal.system.businesses.getByPhoneNumber(body.To);
      if (!business) {
        await dal.system.webhooks.markSkipped(event.id, `No business owns ${body.To}`);
        return reply.type("text/xml").send(twiml('<Reject reason="rejected"/>'));
      }

      const tenant = dal.forBusiness(business.id);
      const { call } = await tenant.calls.startIdempotent({
        provider: "twilio",
        providerCallId: body.CallSid,
        fromNumber: body.From,
        toNumber: body.To,
      });

      if (isNew) {
        await redis.publish(
          liveCallsChannel(business.id),
          serializeLiveCallEvent({
            type: "call.started",
            callId: call.id,
            businessId: business.id,
            at: Date.now(),
            fromMasked: maskPhone(body.From),
          }),
        );
        await dal.system.webhooks.markProcessed(event.id);
      }

      const streamUrl = escapeXml(env.GATEWAY_STREAM_URL);
      return reply
        .type("text/xml")
        .send(
          twiml(
            `<Connect><Stream url="${streamUrl}">` +
              `<Parameter name="callId" value="${escapeXml(call.id)}"/>` +
              `<Parameter name="businessId" value="${escapeXml(business.id)}"/>` +
              `<Parameter name="provider" value="twilio"/>` +
              `</Stream></Connect>`,
          ),
        );
    },
  );

  /**
   * TwiML for auto-callback calls (fetched by Twilio when the missed caller
   * answers): the business number is the From — look the tenant up by it and
   * connect the caller to the agent exactly like an inbound call.
   */
  routes.post(
    "/webhooks/telephony/twilio/outbound-voice",
    { schema: { body: voiceBodySchema } },
    async (request, reply) => {
      if (!checkSignature(request, reply)) return;
      const body = request.body;

      const { event, isNew } = await dal.system.webhooks.recordIfNew({
        provider: "twilio",
        eventId: `${body.CallSid}:outbound-voice`,
        eventType: "call.outbound_voice",
        payload: body,
      });

      const business = await dal.system.businesses.getByPhoneNumber(body.From);
      if (!business) {
        await dal.system.webhooks.markSkipped(event.id, `No business owns ${body.From}`);
        return reply.type("text/xml").send(twiml("<Hangup/>"));
      }

      const tenant = dal.forBusiness(business.id);
      const { call } = await tenant.calls.startIdempotent({
        provider: "twilio",
        providerCallId: body.CallSid,
        direction: "outbound",
        fromNumber: body.To, // the customer being called back
        toNumber: body.From,
      });

      if (isNew) {
        await redis.publish(
          liveCallsChannel(business.id),
          serializeLiveCallEvent({
            type: "call.started",
            callId: call.id,
            businessId: business.id,
            at: Date.now(),
            fromMasked: maskPhone(body.To),
          }),
        );
        await dal.system.webhooks.markProcessed(event.id);
      }

      const streamUrl = escapeXml(env.GATEWAY_STREAM_URL);
      return reply
        .type("text/xml")
        .send(
          twiml(
            `<Connect><Stream url="${streamUrl}">` +
              `<Parameter name="callId" value="${escapeXml(call.id)}"/>` +
              `<Parameter name="businessId" value="${escapeXml(business.id)}"/>` +
              `<Parameter name="provider" value="twilio"/>` +
              `</Stream></Connect>`,
          ),
        );
    },
  );

  routes.post(
    "/webhooks/telephony/twilio/status",
    { schema: { body: statusBodySchema } },
    async (request, reply) => {
      if (!checkSignature(request, reply)) return;
      const body = request.body;

      const terminalStatuses: Record<string, "completed" | "failed"> = {
        completed: "completed",
        busy: "failed",
        failed: "failed",
        "no-answer": "failed",
        canceled: "failed",
      };
      const mapped = terminalStatuses[body.CallStatus];
      if (!mapped) return reply.status(200).send(); // interim statuses are noise

      const { event, isNew } = await dal.system.webhooks.recordIfNew({
        provider: "twilio",
        eventId: `${body.CallSid}:status:${body.CallStatus}`,
        eventType: "call.status",
        payload: body,
      });
      if (!isNew) return reply.status(200).send();

      const call = await dal.system.calls.getByProviderCallId("twilio", body.CallSid);
      if (!call) {
        await dal.system.webhooks.markSkipped(event.id, "Unknown CallSid");
        return reply.status(200).send();
      }

      // Missed-call auto-callback (V1): an inbound call that ended without
      // ever being answered gets a delayed callback job — deterministic jobId
      // dedupes retried webhooks; the callback endpoint re-checks state.
      if (call.direction === "inbound" && call.answeredAt == null) {
        await deps.jobs.enqueue(
          { type: "missed_call_callback", callId: call.id, businessId: call.businessId },
          { jobId: callbackJobId(call.id), delayMs: MISSED_CALL_CALLBACK_DELAY_MS },
        );
      }

      // The gateway normally completes calls with rich metrics; this path
      // reconciles crashes and never-answered calls so no live call zombies.
      if (call.status !== "completed" && call.status !== "failed") {
        const tenant = dal.forBusiness(call.businessId);
        await tenant.calls.complete(call.id, {
          status: mapped,
          endedAt: new Date(),
          ...(body.CallDuration !== undefined ? { durationSec: body.CallDuration } : {}),
          ...(mapped === "failed" ? { outcome: "failed" as const } : {}),
        });
        await redis.publish(
          liveCallsChannel(call.businessId),
          serializeLiveCallEvent({
            type: "call.ended",
            callId: call.id,
            businessId: call.businessId,
            at: Date.now(),
            ...(body.CallDuration !== undefined ? { durationSec: body.CallDuration } : {}),
          }),
        );
      }
      await dal.system.webhooks.markProcessed(event.id);
      return reply.status(200).send();
    },
  );

  routes.post(
    "/webhooks/telephony/twilio/recording",
    { schema: { body: recordingBodySchema } },
    async (request, reply) => {
      if (!checkSignature(request, reply)) return;
      const body = request.body;

      const { event, isNew } = await dal.system.webhooks.recordIfNew({
        provider: "twilio",
        eventId: body.RecordingSid,
        eventType: "call.recording",
        payload: body,
      });
      if (!isNew) return reply.status(200).send();

      const call = await dal.system.calls.getByProviderCallId("twilio", body.CallSid);
      if (!call) {
        await dal.system.webhooks.markSkipped(event.id, "Unknown CallSid");
        return reply.status(200).send();
      }
      // Store the provider reference, then hand off to the recordings worker,
      // which re-homes the audio in the private bucket (ADR-0006).
      await dal.forBusiness(call.businessId).calls.setRecording(call.id, body.RecordingUrl);
      await deps.jobs.enqueue(
        {
          type: "recording_migration",
          callId: call.id,
          businessId: call.businessId,
          sourceUrl: body.RecordingUrl,
        },
        { jobId: recordingJobId(call.id) },
      );
      await dal.system.webhooks.markProcessed(event.id);
      return reply.status(200).send();
    },
  );
}

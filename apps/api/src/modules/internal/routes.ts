import { CALL_OUTCOMES, TELEPHONY_PROVIDERS, TURN_ROLES } from "@vaanidesk/core";
import { AppError, formatINR } from "@vaanidesk/shared";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppDeps } from "../../context.js";
import type { AuthGuards } from "../../plugins/auth.js";
import { getDayAvailability } from "../availability/service.js";
import { cancelBooking, createBooking } from "../bookings/service.js";
import { toBookingDto, toBusinessDto, toServiceDto } from "../dto.js";
import { isoDateTimeSchema, unwrap } from "../route-utils.js";
import { createOutboundCall, redirectCallToDial } from "../telephony/twilio-rest.js";
import { isOpenAtInstant } from "@vaanidesk/core";

const businessIdField = z.object({ businessId: z.string().uuid() });

const turnMetricsSchema = z
  .object({
    sttEndpointMs: z.number().nonnegative(),
    llmTtftMs: z.number().nonnegative(),
    llmTotalMs: z.number().nonnegative(),
    toolMs: z.number().nonnegative(),
    ttsTtfbMs: z.number().nonnegative(),
    turnTotalMs: z.number().nonnegative(),
  })
  .partial();

const toolCallRecordSchema = z.object({
  name: z.string(),
  input: z.unknown(),
  ok: z.boolean(),
  result: z.unknown().optional(),
  durationMs: z.number().nonnegative().optional(),
});

const latencyRollupSchema = z.object({
  turnCount: z.number().int().nonnegative(),
  p50: turnMetricsSchema,
  p95: turnMetricsSchema,
});

const costBreakdownSchema = z
  .object({
    sttPaise: z.number().int().nonnegative(),
    llmPaise: z.number().int().nonnegative(),
    ttsPaise: z.number().int().nonnegative(),
    telephonyPaise: z.number().int().nonnegative(),
    whatsappPaise: z.number().int().nonnegative(),
  })
  .partial();

const tokenUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative().optional(),
  cacheWriteTokens: z.number().int().nonnegative().optional(),
});

/**
 * Service-to-service surface for the voice gateway. Every durable action a
 * call performs lands here — the gateway holds no DB credentials (ADR-0002),
 * and tool responses are the only facts the agent is allowed to speak.
 */
export function registerInternalRoutes(
  app: FastifyInstance,
  deps: AppDeps,
  guards: AuthGuards,
): void {
  const routes = app.withTypeProvider<ZodTypeProvider>();
  const auth = [guards.requireServiceToken];

  /** Everything the gateway needs to run a call: profile, services, policy. */
  routes.get(
    "/v1/internal/calls/:provider/:providerCallId/context",
    {
      schema: {
        params: z.object({
          provider: z.enum(TELEPHONY_PROVIDERS),
          providerCallId: z.string().min(1),
        }),
      },
      preHandler: auth,
    },
    async (request) => {
      const call = await deps.dal.system.calls.getByProviderCallId(
        request.params.provider,
        request.params.providerCallId,
      );
      if (!call) throw AppError.notFound("Call", request.params.providerCallId);

      const tenant = deps.dal.forBusiness(call.businessId);
      const [business, services] = await Promise.all([
        tenant.business.get(),
        tenant.services.list(),
      ]);
      return {
        call: { id: call.id, businessId: call.businessId, fromNumber: call.fromNumber },
        business: toBusinessDto(business),
        services: services.map((service) => ({
          ...toServiceDto(service),
          priceDisplay: formatINR(service.pricePaise),
        })),
      };
    },
  );

  // ── Agent tools ───────────────────────────────────────────────────────────

  routes.post(
    "/v1/internal/tools/check_availability",
    {
      schema: {
        body: businessIdField.extend({
          serviceId: z.string().uuid(),
          date: z.string(),
          /** Voice UX: a caller can absorb only a few options at once. */
          maxSlots: z.number().int().min(1).max(20).default(6),
        }),
      },
      preHandler: auth,
    },
    async (request) => {
      const tenant = deps.dal.forBusiness(request.body.businessId);
      const business = await tenant.business.get();
      const availability = unwrap(
        await getDayAvailability(
          { tenant, business },
          { serviceId: request.body.serviceId, date: request.body.date },
        ),
      );
      return {
        date: availability.date,
        open: availability.open,
        service: availability.service,
        totalOpenSlots: availability.slots.length,
        slots: availability.slots.slice(0, request.body.maxSlots),
      };
    },
  );

  routes.post(
    "/v1/internal/tools/create_booking",
    {
      schema: {
        body: businessIdField.extend({
          callId: z.string().uuid(),
          serviceId: z.string().uuid(),
          startsAt: isoDateTimeSchema,
          customerName: z.string().trim().min(1).max(100),
          customerPhone: z.string().trim().min(4).max(20),
          idempotencyKey: z.string().min(8).max(120),
          notes: z.string().trim().max(500).nullish(),
        }),
      },
      preHandler: auth,
    },
    async (request, reply) => {
      const tenant = deps.dal.forBusiness(request.body.businessId);
      const business = await tenant.business.get();
      const { booking, created } = unwrap(
        await createBooking(
          { tenant, business, actor: { type: "agent", id: request.body.callId }, jobs: deps.jobs },
          {
            serviceId: request.body.serviceId,
            startsAt: request.body.startsAt,
            customerName: request.body.customerName,
            customerPhone: request.body.customerPhone,
            notes: request.body.notes ?? null,
            source: "voice",
            callId: request.body.callId,
            idempotencyKey: request.body.idempotencyKey,
          },
        ),
      );
      return reply.status(created ? 201 : 200).send({
        booking: toBookingDto(booking),
        created,
        priceDisplay: formatINR(booking.pricePaise),
      });
    },
  );

  routes.post(
    "/v1/internal/tools/cancel_booking",
    {
      schema: {
        body: businessIdField.extend({
          callId: z.string().uuid(),
          customerPhone: z.string().trim().min(4).max(20),
          bookingId: z.string().uuid().optional(),
          reason: z.string().trim().max(500).optional(),
        }),
      },
      preHandler: auth,
    },
    async (request) => {
      const tenant = deps.dal.forBusiness(request.body.businessId);
      const business = await tenant.business.get();

      let bookingId = request.body.bookingId;
      if (!bookingId) {
        const recent = await tenant.bookings.listByCustomerPhone(request.body.customerPhone);
        const upcoming = recent.filter(
          (b) =>
            (b.status === "confirmed" || b.status === "pending") &&
            b.startsAt.getTime() > Date.now(),
        );
        if (upcoming.length === 0) {
          throw AppError.notFound("Upcoming booking for this phone number");
        }
        if (upcoming.length > 1) {
          throw AppError.conflict("Multiple upcoming bookings — ask which one to cancel", {
            candidates: upcoming.map((b) => ({
              bookingId: b.id,
              startsAt: b.startsAt.toISOString(),
              serviceId: b.serviceId,
            })),
          });
        }
        bookingId = upcoming[0]!.id;
      }

      const booking = unwrap(
        await cancelBooking(
          { tenant, business, actor: { type: "agent", id: request.body.callId }, jobs: deps.jobs },
          bookingId,
          request.body.reason,
        ),
      );
      return { booking: toBookingDto(booking) };
    },
  );

  // ── Call lifecycle ────────────────────────────────────────────────────────

  routes.post(
    "/v1/internal/calls/:callId/answered",
    {
      schema: { params: z.object({ callId: z.string().uuid() }), body: businessIdField },
      preHandler: auth,
    },
    async (request) => {
      await deps.dal.forBusiness(request.body.businessId).calls.markAnswered(request.params.callId);
      return { ok: true };
    },
  );

  routes.post(
    "/v1/internal/calls/:callId/turns",
    {
      schema: {
        params: z.object({ callId: z.string().uuid() }),
        body: businessIdField.extend({
          turnIndex: z.number().int().nonnegative(),
          role: z.enum(TURN_ROLES),
          text: z.string().max(10_000).nullish(),
          toolCalls: z.array(toolCallRecordSchema).optional(),
          audioKey: z.string().max(500).nullish(),
          startedAt: isoDateTimeSchema.optional(),
          endedAt: isoDateTimeSchema.optional(),
          metrics: turnMetricsSchema.optional(),
        }),
      },
      preHandler: auth,
    },
    async (request) => {
      const { businessId, ...turn } = request.body;
      const saved = await deps.dal.forBusiness(businessId).calls.appendTurn(request.params.callId, {
        turnIndex: turn.turnIndex,
        role: turn.role,
        text: turn.text ?? null,
        toolCalls: turn.toolCalls ?? null,
        audioKey: turn.audioKey ?? null,
        startedAt: turn.startedAt ?? null,
        endedAt: turn.endedAt ?? null,
        metrics: turn.metrics ?? null,
      });
      // Null means the (callId, turnIndex) row already exists — idempotent retry.
      return { ok: true, duplicate: saved == null };
    },
  );

  /**
   * Human fallback: redirect the live provider call to <Dial>ownerPhone</Dial>.
   * The gateway calls this on transfer_to_owner; media streaming stops when the
   * provider executes the new TwiML (the gateway sees a `stop` event).
   */
  routes.post(
    "/v1/internal/calls/:callId/transfer",
    {
      schema: {
        params: z.object({ callId: z.string().uuid() }),
        body: businessIdField.extend({ reason: z.string().max(300).optional() }),
      },
      preHandler: auth,
    },
    async (request) => {
      const tenant = deps.dal.forBusiness(request.body.businessId);
      const [call, business] = await Promise.all([
        tenant.calls.getById(request.params.callId),
        tenant.business.get(),
      ]);
      if (!call) throw AppError.notFound("Call", request.params.callId);
      if (!business.ownerPhone) {
        throw AppError.conflict("No owner phone configured for transfer");
      }
      if (call.provider !== "twilio") {
        throw AppError.conflict(`Transfer not implemented for provider "${call.provider}"`);
      }
      const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN } = deps.env;
      if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
        throw new AppError("service_unavailable", "Telephony REST credentials not configured");
      }

      await redirectCallToDial(
        { accountSid: TWILIO_ACCOUNT_SID, authToken: TWILIO_AUTH_TOKEN },
        call.providerCallId,
        business.ownerPhone,
      );
      await tenant.calls.complete(call.id, {
        status: "completed",
        endedAt: new Date(),
        outcome: "transferred",
        transferredTo: business.ownerPhone,
      });
      await tenant.audit.record({
        actorType: "agent",
        actorId: call.id,
        action: "call.transferred",
        entityType: "call",
        entityId: call.id,
        metadata: request.body.reason !== undefined ? { reason: request.body.reason } : {},
      });
      return { ok: true, transferredTo: business.ownerPhone };
    },
  );

  /**
   * Missed-call auto-callback (V1): originate an outbound call to the missed
   * caller; on answer Twilio fetches TwiML from the outbound-voice webhook,
   * which connects them straight to the agent. Skips (409) when the business
   * is closed or the caller already booked meanwhile — the worker treats 4xx
   * as an audited skip, 5xx as retryable.
   */
  routes.post(
    "/v1/internal/callbacks",
    {
      schema: { body: businessIdField.extend({ callId: z.string().uuid() }) },
      preHandler: auth,
    },
    async (request) => {
      const tenant = deps.dal.forBusiness(request.body.businessId);
      const [call, business] = await Promise.all([
        tenant.calls.getById(request.body.callId),
        tenant.business.get(),
      ]);
      if (!call) throw AppError.notFound("Call", request.body.callId);
      if (call.provider !== "twilio") {
        throw AppError.conflict(`Callback not implemented for provider "${call.provider}"`);
      }
      if (!business.phoneNumber) throw AppError.conflict("Business has no provisioned number");
      if (!isOpenAtInstant(business.hours, business.timezone, Date.now())) {
        throw AppError.conflict("Business is closed right now — callback skipped");
      }
      const upcoming = (await tenant.bookings.listByCustomerPhone(call.fromNumber, 5)).filter(
        (b) =>
          (b.status === "confirmed" || b.status === "pending") && b.startsAt.getTime() > Date.now(),
      );
      if (upcoming.length > 0) {
        throw AppError.conflict("Caller already has an upcoming booking — callback skipped");
      }
      const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN } = deps.env;
      if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
        throw new AppError("service_unavailable", "Telephony REST credentials not configured");
      }

      await createOutboundCall(
        { accountSid: TWILIO_ACCOUNT_SID, authToken: TWILIO_AUTH_TOKEN },
        {
          from: business.phoneNumber,
          to: call.fromNumber,
          twimlUrl: `${deps.env.PUBLIC_API_URL}/webhooks/telephony/twilio/outbound-voice`,
        },
      );
      await tenant.audit.record({
        actorType: "system",
        actorId: "callback",
        action: "call.callback_initiated",
        entityType: "call",
        entityId: call.id,
        metadata: { to: call.fromNumber },
      });
      return { ok: true };
    },
  );

  routes.post(
    "/v1/internal/calls/:callId/complete",
    {
      schema: {
        params: z.object({ callId: z.string().uuid() }),
        body: businessIdField.extend({
          status: z.enum(["completed", "failed"]),
          endedAt: isoDateTimeSchema,
          durationSec: z.number().int().nonnegative().optional(),
          outcome: z.enum(CALL_OUTCOMES).optional(),
          language: z.string().max(20).optional(),
          recordingKey: z.string().max(500).optional(),
          transferredTo: z.string().max(20).optional(),
          latencyRollup: latencyRollupSchema.optional(),
          costBreakdown: costBreakdownSchema.optional(),
          totalCostPaise: z.number().int().nonnegative().optional(),
          tokenUsage: tokenUsageSchema.optional(),
        }),
      },
      preHandler: auth,
    },
    async (request) => {
      const { businessId, ...completion } = request.body;
      const call = await deps.dal
        .forBusiness(businessId)
        .calls.complete(request.params.callId, completion);
      if (!call) throw AppError.notFound("Call", request.params.callId);
      return { ok: true };
    },
  );
}

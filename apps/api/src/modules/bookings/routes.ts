import { randomUUID } from "node:crypto";
import { AppError } from "@vaanidesk/shared";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppDeps } from "../../context.js";
import type { AuthGuards } from "../../plugins/auth.js";
import { toBookingDto } from "../dto.js";
import { businessIdParamSchema, isoDateTimeSchema, tenantOf, unwrap } from "../route-utils.js";
import {
  cancelBooking,
  createBooking,
  markBookingOutcome,
  rescheduleBooking,
  type BookingActor,
} from "./service.js";

const bookingParamsSchema = businessIdParamSchema.extend({
  bookingId: z.string().uuid(),
});

const createBookingBodySchema = z.object({
  serviceId: z.string().uuid(),
  startsAt: isoDateTimeSchema,
  customerName: z.string().trim().min(1).max(100),
  customerPhone: z.string().trim().min(4).max(20),
  notes: z.string().trim().max(1000).nullish(),
  /** Client-generated for safe retries; server fills one in if absent. */
  idempotencyKey: z.string().min(8).max(120).optional(),
});

function actorFor(userId: string | undefined): BookingActor {
  return { type: "user", ...(userId !== undefined ? { id: userId } : {}) };
}

export function registerBookingRoutes(
  app: FastifyInstance,
  deps: AppDeps,
  guards: AuthGuards,
): void {
  const routes = app.withTypeProvider<ZodTypeProvider>();

  routes.get(
    "/v1/businesses/:businessId/bookings",
    {
      schema: {
        params: businessIdParamSchema,
        querystring: z.object({
          from: isoDateTimeSchema,
          to: isoDateTimeSchema,
        }),
      },
      preHandler: [guards.requireMembership()],
    },
    async (request) => {
      const { from, to } = request.query;
      if (to.getTime() <= from.getTime()) {
        throw AppError.validation("`to` must be after `from`");
      }
      if (to.getTime() - from.getTime() > 62 * 24 * 60 * 60 * 1000) {
        throw AppError.validation("Range too large — request at most 62 days");
      }
      const rows = await tenantOf(request).bookings.listInRange(from, to);
      return {
        bookings: rows.map((row) =>
          toBookingDto(row, { service: row.service, resource: row.resource }),
        ),
      };
    },
  );

  routes.get(
    "/v1/businesses/:businessId/bookings/:bookingId",
    { schema: { params: bookingParamsSchema }, preHandler: [guards.requireMembership()] },
    async (request) => {
      const booking = await tenantOf(request).bookings.getById(request.params.bookingId);
      if (!booking) throw AppError.notFound("Booking", request.params.bookingId);
      return { booking: toBookingDto(booking) };
    },
  );

  routes.post(
    "/v1/businesses/:businessId/bookings",
    {
      schema: { params: businessIdParamSchema, body: createBookingBodySchema },
      preHandler: [guards.requireMembership()],
    },
    async (request, reply) => {
      const tenant = tenantOf(request);
      const business = await tenant.business.get();
      const { booking, created } = unwrap(
        await createBooking(
          { tenant, business, actor: actorFor(request.user?.id), jobs: deps.jobs },
          {
            serviceId: request.body.serviceId,
            startsAt: request.body.startsAt,
            customerName: request.body.customerName,
            customerPhone: request.body.customerPhone,
            notes: request.body.notes ?? null,
            source: "dashboard",
            idempotencyKey: request.body.idempotencyKey ?? randomUUID(),
          },
        ),
      );
      return reply.status(created ? 201 : 200).send({ booking: toBookingDto(booking), created });
    },
  );

  routes.post(
    "/v1/businesses/:businessId/bookings/:bookingId/cancel",
    {
      schema: {
        params: bookingParamsSchema,
        body: z.object({ reason: z.string().trim().max(500).optional() }).default({}),
      },
      preHandler: [guards.requireMembership()],
    },
    async (request) => {
      const tenant = tenantOf(request);
      const business = await tenant.business.get();
      const booking = unwrap(
        await cancelBooking(
          { tenant, business, actor: actorFor(request.user?.id), jobs: deps.jobs },
          request.params.bookingId,
          request.body.reason,
        ),
      );
      return { booking: toBookingDto(booking) };
    },
  );

  routes.post(
    "/v1/businesses/:businessId/bookings/:bookingId/reschedule",
    {
      schema: {
        params: bookingParamsSchema,
        body: z.object({ startsAt: isoDateTimeSchema }),
      },
      preHandler: [guards.requireMembership()],
    },
    async (request) => {
      const tenant = tenantOf(request);
      const business = await tenant.business.get();
      const booking = unwrap(
        await rescheduleBooking(
          { tenant, business, actor: actorFor(request.user?.id), jobs: deps.jobs },
          request.params.bookingId,
          request.body.startsAt,
        ),
      );
      return { booking: toBookingDto(booking) };
    },
  );

  routes.post(
    "/v1/businesses/:businessId/bookings/:bookingId/status",
    {
      schema: {
        params: bookingParamsSchema,
        body: z.object({ status: z.enum(["completed", "no_show"]) }),
      },
      preHandler: [guards.requireMembership()],
    },
    async (request) => {
      const tenant = tenantOf(request);
      const business = await tenant.business.get();
      const booking = unwrap(
        await markBookingOutcome(
          { tenant, business, actor: actorFor(request.user?.id), jobs: deps.jobs },
          request.params.bookingId,
          request.body.status,
        ),
      );
      return { booking: toBookingDto(booking) };
    },
  );
}

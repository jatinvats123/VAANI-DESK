import { AppError } from "@vaanidesk/shared";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppDeps } from "../../context.js";
import type { AuthGuards } from "../../plugins/auth.js";
import { toServiceDto } from "../dto.js";
import { businessIdParamSchema, tenantOf } from "../route-utils.js";

const serviceBodySchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).nullish(),
  durationMin: z.number().int().min(5).max(480),
  pricePaise: z
    .number()
    .int()
    .min(0)
    .max(100_000_00 * 10), // ₹10L ceiling
  sortOrder: z.number().int().min(0).max(1000).default(0),
});

const serviceParamsSchema = businessIdParamSchema.extend({
  serviceId: z.string().uuid(),
});

export function registerServiceRoutes(
  app: FastifyInstance,
  _deps: AppDeps,
  guards: AuthGuards,
): void {
  const routes = app.withTypeProvider<ZodTypeProvider>();

  routes.get(
    "/v1/businesses/:businessId/services",
    {
      schema: {
        params: businessIdParamSchema,
        querystring: z.object({ includeInactive: z.coerce.boolean().default(false) }),
      },
      preHandler: [guards.requireMembership()],
    },
    async (request) => {
      const services = await tenantOf(request).services.list({
        includeInactive: request.query.includeInactive,
      });
      return { services: services.map(toServiceDto) };
    },
  );

  routes.post(
    "/v1/businesses/:businessId/services",
    {
      schema: { params: businessIdParamSchema, body: serviceBodySchema },
      preHandler: [guards.requireMembership("owner")],
    },
    async (request, reply) => {
      const tenant = tenantOf(request);
      const service = await tenant.services.create(request.body);
      await tenant.audit.record({
        actorType: "user",
        actorId: request.user?.id,
        action: "service.created",
        entityType: "service",
        entityId: service.id,
        metadata: { name: service.name, pricePaise: service.pricePaise },
      });
      return reply.status(201).send({ service: toServiceDto(service) });
    },
  );

  routes.patch(
    "/v1/businesses/:businessId/services/:serviceId",
    {
      schema: {
        params: serviceParamsSchema,
        body: serviceBodySchema.partial().extend({ active: z.boolean().optional() }),
      },
      preHandler: [guards.requireMembership("owner")],
    },
    async (request) => {
      const tenant = tenantOf(request);
      const before = await tenant.services.getById(request.params.serviceId);
      if (!before) throw AppError.notFound("Service", request.params.serviceId);

      const service = await tenant.services.update(request.params.serviceId, request.body);
      if (!service) throw AppError.notFound("Service", request.params.serviceId);

      // Price changes are audit-relevant: the agent quotes these numbers on calls.
      if (request.body.pricePaise !== undefined && request.body.pricePaise !== before.pricePaise) {
        await tenant.audit.record({
          actorType: "user",
          actorId: request.user?.id,
          action: "service.price_changed",
          entityType: "service",
          entityId: service.id,
          metadata: { from: before.pricePaise, to: request.body.pricePaise },
        });
      }
      return { service: toServiceDto(service) };
    },
  );
}

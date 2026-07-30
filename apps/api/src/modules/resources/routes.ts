import { RESOURCE_TYPES } from "@vaanidesk/core";
import { AppError } from "@vaanidesk/shared";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppDeps } from "../../context.js";
import type { AuthGuards } from "../../plugins/auth.js";
import { toResourceDto } from "../dto.js";
import { businessIdParamSchema, tenantOf } from "../route-utils.js";

const resourceBodySchema = z.object({
  name: z.string().trim().min(1).max(100),
  type: z.enum(RESOURCE_TYPES).default("staff"),
});

export function registerResourceRoutes(
  app: FastifyInstance,
  _deps: AppDeps,
  guards: AuthGuards,
): void {
  const routes = app.withTypeProvider<ZodTypeProvider>();

  routes.get(
    "/v1/businesses/:businessId/resources",
    {
      schema: {
        params: businessIdParamSchema,
        querystring: z.object({ includeInactive: z.coerce.boolean().default(false) }),
      },
      preHandler: [guards.requireMembership()],
    },
    async (request) => {
      const resources = await tenantOf(request).resources.list({
        includeInactive: request.query.includeInactive,
      });
      return { resources: resources.map(toResourceDto) };
    },
  );

  routes.post(
    "/v1/businesses/:businessId/resources",
    {
      schema: { params: businessIdParamSchema, body: resourceBodySchema },
      preHandler: [guards.requireMembership("owner")],
    },
    async (request, reply) => {
      const resource = await tenantOf(request).resources.create(request.body);
      return reply.status(201).send({ resource: toResourceDto(resource) });
    },
  );

  routes.patch(
    "/v1/businesses/:businessId/resources/:resourceId",
    {
      schema: {
        params: businessIdParamSchema.extend({ resourceId: z.string().uuid() }),
        body: resourceBodySchema.partial().extend({ active: z.boolean().optional() }),
      },
      preHandler: [guards.requireMembership("owner")],
    },
    async (request) => {
      const resource = await tenantOf(request).resources.update(
        request.params.resourceId,
        request.body,
      );
      if (!resource) throw AppError.notFound("Resource", request.params.resourceId);
      return { resource: toResourceDto(resource) };
    },
  );
}

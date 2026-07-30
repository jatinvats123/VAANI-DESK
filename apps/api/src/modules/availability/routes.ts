import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppDeps } from "../../context.js";
import type { AuthGuards } from "../../plugins/auth.js";
import { businessIdParamSchema, tenantOf, unwrap } from "../route-utils.js";
import { getDayAvailability } from "./service.js";

export function registerAvailabilityRoutes(
  app: FastifyInstance,
  _deps: AppDeps,
  guards: AuthGuards,
): void {
  const routes = app.withTypeProvider<ZodTypeProvider>();

  routes.get(
    "/v1/businesses/:businessId/availability",
    {
      schema: {
        params: businessIdParamSchema,
        querystring: z.object({
          serviceId: z.string().uuid(),
          date: z.string(),
        }),
      },
      preHandler: [guards.requireMembership()],
    },
    async (request) => {
      const tenant = tenantOf(request);
      const business = await tenant.business.get();
      return unwrap(
        await getDayAvailability(
          { tenant, business },
          { serviceId: request.query.serviceId, date: request.query.date },
        ),
      );
    },
  );
}

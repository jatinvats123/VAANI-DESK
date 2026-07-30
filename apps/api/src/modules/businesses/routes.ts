import {
  addDaysISO,
  AppError,
  businessHoursSchema,
  normalizePhone,
  promptConfigSchema,
  slugWithSuffix,
  timeZoneSchema,
  utcToLocalDateISO,
} from "@vaanidesk/shared";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppDeps } from "../../context.js";
import type { AuthGuards } from "../../plugins/auth.js";
import { toBusinessDto } from "../dto.js";
import { businessIdParamSchema, tenantOf } from "../route-utils.js";

const createBusinessSchema = z.object({
  name: z.string().trim().min(2).max(100),
  timezone: timeZoneSchema.default("Asia/Kolkata"),
});

const phoneField = z.string().transform((value, ctx) => {
  const result = normalizePhone(value);
  if (!result.ok) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: result.error });
    return z.NEVER;
  }
  return result.value;
});

const updateBusinessSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    ownerPhone: phoneField.nullable(),
    notificationPhone: phoneField.nullable(),
    timezone: timeZoneSchema,
    hours: businessHoursSchema,
    promptConfig: promptConfigSchema,
    slotGranularityMin: z.number().int().min(5).max(120),
    bookingBufferMin: z.number().int().min(0).max(120),
    minNoticeMin: z
      .number()
      .int()
      .min(0)
      .max(7 * 24 * 60),
    maxAdvanceDays: z.number().int().min(1).max(365),
  })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, { message: "Empty update" });

export function registerBusinessRoutes(
  app: FastifyInstance,
  deps: AppDeps,
  guards: AuthGuards,
): void {
  const routes = app.withTypeProvider<ZodTypeProvider>();

  routes.get("/v1/me", { preHandler: [guards.requireUser] }, async (request) => {
    const user = request.user;
    if (!user) throw AppError.unauthorized();
    const businesses = await deps.dal.system.businesses.listForUser(user.id);
    return {
      user: { id: user.id, name: user.name, email: user.email, image: user.image },
      businesses: businesses.map(({ business, role }) => ({
        id: business.id,
        name: business.name,
        slug: business.slug,
        role,
        onboarded: business.onboardedAt != null,
      })),
    };
  });

  routes.post(
    "/v1/businesses",
    { schema: { body: createBusinessSchema }, preHandler: [guards.requireUser] },
    async (request, reply) => {
      const user = request.user;
      if (!user) throw AppError.unauthorized();
      const business = await deps.dal.system.businesses.createWithOwner({
        name: request.body.name,
        slug: slugWithSuffix(request.body.name),
        timezone: request.body.timezone,
        ownerUserId: user.id,
      });
      return reply.status(201).send({ business: toBusinessDto(business) });
    },
  );

  routes.get(
    "/v1/businesses/:businessId",
    { schema: { params: businessIdParamSchema }, preHandler: [guards.requireMembership()] },
    async (request) => ({ business: toBusinessDto(await tenantOf(request).business.get()) }),
  );

  routes.patch(
    "/v1/businesses/:businessId",
    {
      schema: { params: businessIdParamSchema, body: updateBusinessSchema },
      preHandler: [guards.requireMembership("owner")],
    },
    async (request) => {
      const business = await tenantOf(request).business.update(request.body);
      await tenantOf(request).audit.record({
        actorType: "user",
        actorId: request.user?.id,
        action: "business.updated",
        entityType: "business",
        entityId: business.id,
        metadata: { fields: Object.keys(request.body) },
      });
      return { business: toBusinessDto(business) };
    },
  );

  routes.get(
    "/v1/businesses/:businessId/analytics",
    {
      schema: {
        params: businessIdParamSchema,
        querystring: z.object({ days: z.coerce.number().int().min(1).max(90).default(7) }),
      },
      preHandler: [guards.requireMembership()],
    },
    async (request) => {
      const tenant = tenantOf(request);
      const to = new Date();
      const from = new Date(to.getTime() - request.query.days * 24 * 60 * 60 * 1000);
      const business = await tenant.business.get();
      const [summary, series] = await Promise.all([
        tenant.analytics.summary(from, to),
        tenant.analytics.dailySeries(from, to, business.timezone),
      ]);

      // Dense series: every business-local day in range, zero-filled.
      const callsByDay = new Map(series.callRows.map((r) => [r.day, r.count]));
      const bookingsByDay = new Map(series.bookingRows.map((r) => [r.day, r]));
      const daily: Array<{
        date: string;
        calls: number;
        bookings: number;
        voiceRevenuePaise: number;
      }> = [];
      let cursor = utcToLocalDateISO(from.getTime(), business.timezone);
      const lastDay = utcToLocalDateISO(to.getTime(), business.timezone);
      while (cursor <= lastDay) {
        const bookingRow = bookingsByDay.get(cursor);
        daily.push({
          date: cursor,
          calls: callsByDay.get(cursor) ?? 0,
          bookings: bookingRow?.count ?? 0,
          voiceRevenuePaise: bookingRow?.voiceRevenuePaise ?? 0,
        });
        cursor = addDaysISO(cursor, 1);
      }

      return {
        days: request.query.days,
        from: from.toISOString(),
        to: to.toISOString(),
        ...summary,
        daily,
      };
    },
  );

  routes.post(
    "/v1/businesses/:businessId/complete-onboarding",
    { schema: { params: businessIdParamSchema }, preHandler: [guards.requireMembership("owner")] },
    async (request) => {
      const tenant = tenantOf(request);
      const current = await tenant.business.get();
      if (current.onboardedAt) return { business: toBusinessDto(current) };

      const hasService = (await tenant.services.list()).length > 0;
      if (!hasService) {
        throw AppError.conflict("Add at least one service before completing onboarding");
      }
      const business = await tenant.business.update({ onboardedAt: new Date() });
      await tenant.audit.record({
        actorType: "user",
        actorId: request.user?.id,
        action: "business.onboarded",
        entityType: "business",
        entityId: business.id,
      });
      return { business: toBusinessDto(business) };
    },
  );
}

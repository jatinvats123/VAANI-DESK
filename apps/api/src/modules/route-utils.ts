import { AppError, type Result } from "@vaanidesk/shared";
import type { FastifyRequest } from "fastify";
import type { TenantDal } from "@vaanidesk/db";
import { z } from "zod";

/** Service Results become HTTP responses here: Ok → value, Err → thrown AppError. */
export function unwrap<T>(result: Result<T, AppError>): T {
  if (!result.ok) throw result.error;
  return result.value;
}

/** After requireMembership ran; typed accessor instead of non-null assertions. */
export function tenantOf(request: FastifyRequest): TenantDal {
  if (!request.tenant) throw AppError.internal("Route is missing the membership guard");
  return request.tenant;
}

export const businessIdParamSchema = z.object({
  businessId: z.string().uuid(),
});

export const isoDateTimeSchema = z
  .string()
  .datetime({ offset: true })
  .transform((value) => new Date(value));

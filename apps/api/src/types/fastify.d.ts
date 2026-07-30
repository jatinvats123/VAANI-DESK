import type { MembershipRole } from "@vaanidesk/core";
import type { TenantDal, User } from "@vaanidesk/db";

declare module "fastify" {
  interface FastifyRequest {
    /** Set by requireUser. */
    user?: User;
    /** Set by requireMembership — pre-scoped to the business in the route params. */
    tenant?: TenantDal;
    membershipRole?: MembershipRole;
  }
}

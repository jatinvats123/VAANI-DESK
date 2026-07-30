import { timingSafeEqual } from "node:crypto";
import { AppError } from "@vaanidesk/shared";
import type { MembershipRole } from "@vaanidesk/core";
import type { User } from "@vaanidesk/db";
import { schema } from "@vaanidesk/db";
import { eq } from "drizzle-orm";
import type { FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from "fastify";
import type { AppDeps } from "../context.js";

/**
 * Three authentication surfaces:
 *  - Dashboard users: Auth.js database sessions (httpOnly cookie shared with web).
 *  - The voice gateway: constant-time-compared service secret on /v1/internal/*.
 *  - Tenancy: membership check that pre-scopes request.tenant to one business.
 */
export function createAuthGuards(deps: AppDeps) {
  const { dal, db, env } = deps;

  async function resolveSessionUser(request: FastifyRequest): Promise<User | undefined> {
    // Auth.js prefixes the cookie with __Secure- when it set it over HTTPS.
    const token =
      request.cookies[env.AUTH_COOKIE_NAME] ?? request.cookies[`__Secure-${env.AUTH_COOKIE_NAME}`];
    if (!token) return undefined;

    const rows = await db
      .select({ user: schema.users, expires: schema.sessions.expires })
      .from(schema.sessions)
      .innerJoin(schema.users, eq(schema.sessions.userId, schema.users.id))
      .where(eq(schema.sessions.sessionToken, token))
      .limit(1);
    const row = rows[0];
    if (!row || row.expires.getTime() < Date.now()) return undefined;
    return row.user;
  }

  const requireUser: preHandlerAsyncHookHandler = async (request) => {
    const user = await resolveSessionUser(request);
    if (!user) throw AppError.unauthorized();
    request.user = user;
  };

  /**
   * Guard for /v1/businesses/:businessId/* — requires an authenticated member
   * and attaches the tenant-scoped DAL. `minRole: "owner"` restricts to owners.
   */
  function requireMembership(minRole: MembershipRole = "staff"): preHandlerAsyncHookHandler {
    return async (request) => {
      if (!request.user) {
        const user = await resolveSessionUser(request);
        if (!user) throw AppError.unauthorized();
        request.user = user;
      }
      const { businessId } = request.params as { businessId?: string };
      if (!businessId) throw AppError.internal("requireMembership on a route without :businessId");

      const membership = await dal.system.memberships.get(request.user.id, businessId);
      if (!membership) {
        // Same response for "not a member" and "no such business" — no tenant enumeration.
        throw AppError.forbidden();
      }
      if (minRole === "owner" && membership.role !== "owner") {
        throw AppError.forbidden("This action requires the owner role");
      }
      request.membershipRole = membership.role;
      request.tenant = dal.forBusiness(businessId);
    };
  }

  const serviceSecret = Buffer.from(env.INTERNAL_SERVICE_SECRET, "utf8");

  const requireServiceToken: preHandlerAsyncHookHandler = (request) => {
    const header = request.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
    if (!token) throw AppError.unauthorized("Service token required");
    const provided = Buffer.from(token, "utf8");
    if (provided.length !== serviceSecret.length || !timingSafeEqual(provided, serviceSecret)) {
      throw AppError.unauthorized("Invalid service token");
    }
    return Promise.resolve();
  };

  /** WS upgrade auth (no preHandler pipeline): resolve user or reject the socket. */
  async function authenticateWsRequest(
    request: FastifyRequest,
    _reply: FastifyReply,
  ): Promise<User | undefined> {
    return await resolveSessionUser(request);
  }

  return { requireUser, requireMembership, requireServiceToken, authenticateWsRequest };
}

export type AuthGuards = ReturnType<typeof createAuthGuards>;

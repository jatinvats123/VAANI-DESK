import { AppError, pageQuerySchema } from "@vaanidesk/shared";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppDeps } from "../../context.js";
import type { AuthGuards } from "../../plugins/auth.js";
import { toCallDto, toCallTurnDto } from "../dto.js";
import { businessIdParamSchema, tenantOf } from "../route-utils.js";
import { createRecordingSigner, isBucketKey, RECORDING_URL_TTL_SECONDS } from "./recordings.js";

export function registerCallRoutes(app: FastifyInstance, deps: AppDeps, guards: AuthGuards): void {
  const routes = app.withTypeProvider<ZodTypeProvider>();
  const signer = createRecordingSigner(deps.env);

  routes.get(
    "/v1/businesses/:businessId/calls/:callId/recording-url",
    {
      schema: { params: businessIdParamSchema.extend({ callId: z.string().uuid() }) },
      preHandler: [guards.requireMembership()],
    },
    async (request) => {
      const tenant = tenantOf(request);
      const call = await tenant.calls.getById(request.params.callId);
      if (!call) throw AppError.notFound("Call", request.params.callId);
      if (!call.recordingKey) throw AppError.notFound("Recording for this call");
      if (!isBucketKey(call.recordingKey) || !signer.available) {
        // Still provider-hosted (migration pending) or bucket unconfigured —
        // never hand out provider URLs, they carry no tenant auth.
        throw new AppError("conflict", "Recording is still processing — try again shortly");
      }
      const url = await signer.signedUrlForKey(call.recordingKey);
      await tenant.audit.record({
        actorType: "user",
        actorId: request.user?.id,
        action: "call.recording_accessed",
        entityType: "call",
        entityId: call.id,
      });
      return { url, expiresInSeconds: RECORDING_URL_TTL_SECONDS };
    },
  );

  routes.get(
    "/v1/businesses/:businessId/calls",
    {
      schema: { params: businessIdParamSchema, querystring: pageQuerySchema },
      preHandler: [guards.requireMembership()],
    },
    async (request) => {
      const page = await tenantOf(request).calls.listPage({
        limit: request.query.limit,
        ...(request.query.cursor !== undefined ? { cursor: request.query.cursor } : {}),
      });
      return { calls: page.items.map(toCallDto), nextCursor: page.nextCursor };
    },
  );

  routes.get(
    "/v1/businesses/:businessId/calls/:callId",
    {
      schema: { params: businessIdParamSchema.extend({ callId: z.string().uuid() }) },
      preHandler: [guards.requireMembership()],
    },
    async (request) => {
      const call = await tenantOf(request).calls.getWithTurns(request.params.callId);
      if (!call) throw AppError.notFound("Call", request.params.callId);
      return {
        call: toCallDto(call),
        turns: call.turns.map(toCallTurnDto),
      };
    },
  );
}

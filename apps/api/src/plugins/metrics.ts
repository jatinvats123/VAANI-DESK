import { bearerMatches, renderMetrics } from "@vaanidesk/observability";
import type { FastifyInstance } from "fastify";
import type { AppDeps } from "../context.js";

/**
 * Prometheus wiring for the api:
 *  - an `onResponse` hook records request duration by method / route template /
 *    status (the route *template*, e.g. `/v1/businesses/:businessId/bookings`,
 *    so path params don't explode label cardinality);
 *  - `GET /metrics` exposes the registry, guarded by the internal service secret
 *    (metrics reveal call volumes and internal names — not public). It is
 *    allow-listed from rate limiting in server.ts and carries its own auth.
 */
export function registerMetrics(app: FastifyInstance, deps: AppDeps): void {
  const { metrics, env } = deps;

  app.addHook("onResponse", (request, reply, done) => {
    const route = request.routeOptions.url ?? "unknown";
    if (route !== "/metrics") {
      metrics.httpRequestDuration.observe(
        { method: request.method, route, status_code: String(reply.statusCode) },
        reply.elapsedTime / 1000,
      );
    }
    done();
  });

  app.get("/metrics", async (request, reply) => {
    if (!bearerMatches(request.headers.authorization, env.INTERNAL_SERVICE_SECRET)) {
      return reply
        .status(401)
        .send({ error: { code: "unauthorized", message: "metrics require the service token" } });
    }
    const { contentType, body } = await renderMetrics(metrics.registry);
    return reply.header("content-type", contentType).send(body);
  });
}

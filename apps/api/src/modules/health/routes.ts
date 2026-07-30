import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { AppDeps } from "../../context.js";

export function registerHealthRoutes(app: FastifyInstance, deps: AppDeps): void {
  // Liveness: process is up.
  app.get("/healthz", () => ({ status: "ok" }));

  // Readiness: dependencies answer — load balancers route only when this passes.
  app.get("/readyz", async (_request, reply) => {
    const [dbOk, redisOk] = await Promise.all([
      deps.db
        .execute(sql`select 1`)
        .then(() => true)
        .catch(() => false),
      deps.redis
        .ping()
        .then(() => true)
        .catch(() => false),
    ]);
    const ready = dbOk && redisOk;
    return reply.status(ready ? 200 : 503).send({
      status: ready ? "ok" : "degraded",
      checks: { postgres: dbOk, redis: redisOk },
    });
  });
}

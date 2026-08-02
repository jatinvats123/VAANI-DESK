import { createDal, createDatabase } from "@vaanidesk/db";
import { createMetrics, initSentry, initTracing } from "@vaanidesk/observability";
import { config } from "dotenv";
import { Redis } from "ioredis";
import { loadEnv } from "./env.js";
import { createJobQueues } from "./queues.js";
import { buildServer } from "./server.js";
import { pino } from "pino";

// Repo-root .env is the single local config source; package-local overrides win.
config({ path: "../../.env" });
config();

async function main(): Promise<void> {
  const env = loadEnv();
  // Errors first, so a failure anywhere in boot is captured. No-op without DSN.
  const sentry = initSentry("api", {
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    release: env.SENTRY_RELEASE,
  });
  // Before the server is built so request spans have a provider. No-op unless
  // an OTLP endpoint is configured.
  const tracing = await initTracing("api", env.OTEL_EXPORTER_OTLP_ENDPOINT);
  const { db, close: closeDb } = createDatabase(env.DATABASE_URL);
  const dal = createDal(db);
  const redis = new Redis(env.REDIS_URL);
  const createSubscriber = (): Redis => new Redis(env.REDIS_URL);
  const queues = createJobQueues(env.REDIS_URL, pino({ level: env.LOG_LEVEL }));
  const metrics = createMetrics("api");

  const app = await buildServer({ env, db, dal, redis, createSubscriber, jobs: queues.jobs, metrics });

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, "shutting down");
    try {
      await app.close(); // stops accepting; closes WS clients + their subscribers
      await queues.close();
      await redis.quit();
      await closeDb();
      await tracing.shutdown();
      await sentry.flush();
      process.exit(0);
    } catch (error) {
      app.log.error({ err: error }, "graceful shutdown failed");
      process.exit(1);
    }
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  await app.listen({ port: env.API_PORT, host: env.API_HOST });
}

main().catch((error: unknown) => {
  console.error("API failed to start:", error);
  process.exit(1);
});

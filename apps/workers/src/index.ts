import http from "node:http";
import { Queue, Worker } from "bullmq";
import { config } from "dotenv";
import { Redis } from "ioredis";
import { jobPayloadSchema, NOTIFICATIONS_QUEUE } from "@vaanidesk/shared";
import {
  bearerMatches,
  createMetrics,
  extractTraceContext,
  initSentry,
  initTracing,
  renderMetrics,
  Sentry,
  withSpan,
} from "@vaanidesk/observability";
import { createDal, createDatabase } from "@vaanidesk/db";
import { handleMissedCallCallback } from "./callbacks.js";
import { loadEnv } from "./env.js";
import { handleNotificationJob, type HandlerDeps } from "./handlers.js";
import { createLogger } from "./logger.js";
import { createS3Client, handleRecordingMigration } from "./recordings.js";
import { createWhatsappClient } from "./whatsapp/client.js";

config({ path: "../../.env" });
config();

async function main(): Promise<void> {
  const env = loadEnv();
  const log = createLogger(env);
  // Errors first. No-op without a DSN.
  const sentry = initSentry("workers", {
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    release: env.SENTRY_RELEASE,
  });
  // Before any span is created. No-op unless an OTLP endpoint is configured.
  const tracing = await initTracing("workers", env.OTEL_EXPORTER_OTLP_ENDPOINT);
  const { db, close: closeDb } = createDatabase(env.DATABASE_URL, { max: 5 });
  const dal = createDal(db);
  const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  const whatsapp = createWhatsappClient(
    {
      phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
      accessToken: env.WHATSAPP_ACCESS_TOKEN,
      graphVersion: env.WHATSAPP_GRAPH_VERSION,
    },
    log,
  );
  const deps: HandlerDeps = { dal, whatsapp, env, log };
  const s3 = createS3Client(env);
  const metrics = createMetrics("workers");

  const worker = new Worker(
    NOTIFICATIONS_QUEUE,
    async (job) => {
      // Version-skew safety: an unrecognized payload fails visibly, not weirdly.
      // (The __trace carrier the api adds is stripped here by the strict schema.)
      const parsed = jobPayloadSchema.safeParse(job.data);
      if (!parsed.success) {
        log.error({ jobId: job.id, issues: parsed.error.issues }, "invalid job payload — dropping");
        return;
      }
      // Continue the call's trace: the api forwarded its context under __trace.
      const carrier = (job.data as { __trace?: Record<string, string> }).__trace ?? {};
      const parent = extractTraceContext(carrier);
      await withSpan(
        `worker.${job.name}`,
        { "job.id": job.id ?? "", "job.type": job.name },
        async () => {
          if (parsed.data.type === "recording_migration") {
            await handleRecordingMigration({ dal, env, log, s3 }, parsed.data);
            return;
          }
          if (parsed.data.type === "missed_call_callback") {
            await handleMissedCallCallback({ env, log }, parsed.data);
            return;
          }
          await handleNotificationJob(deps, parsed.data);
        },
        parent,
      );
    },
    { connection, concurrency: env.WORKER_CONCURRENCY },
  );

  worker.on("completed", (job) => {
    metrics.queueJobs.inc({ queue: NOTIFICATIONS_QUEUE, job_type: job.name, result: "ok" });
  });
  worker.on("failed", (job, error) => {
    // Fires on every attempt; "failed" here means this attempt failed.
    metrics.queueJobs.inc({ queue: NOTIFICATIONS_QUEUE, job_type: job?.name ?? "unknown", result: "failed" });
    log.error(
      { jobId: job?.id, attempts: job?.attemptsMade, err: error },
      "job failed (will retry per backoff policy until attempts exhausted)",
    );
    // Only report to Sentry once retries are exhausted — transient failures that
    // later succeed aren't worth an alert. No-op when SENTRY_DSN is unset.
    const maxAttempts = job?.opts.attempts ?? 1;
    if (job && job.attemptsMade >= maxAttempts) {
      Sentry.captureException(error, {
        tags: { job_type: job.name },
        extra: { jobId: job.id, attempts: job.attemptsMade },
      });
    }
  });
  worker.on("error", (error) => {
    log.error({ err: error }, "worker connection error");
  });

  // Poll queue depth by state for the vd_queue_depth gauge. A read-side Queue
  // handle shares the connection pool but issues its own commands.
  const queue = new Queue(NOTIFICATIONS_QUEUE, { connection });
  const pollDepth = async (): Promise<void> => {
    try {
      const counts = await queue.getJobCounts("waiting", "active", "delayed", "failed", "completed");
      for (const [state, value] of Object.entries(counts)) {
        metrics.queueDepth.set({ queue: NOTIFICATIONS_QUEUE, state }, value);
      }
    } catch (error) {
      log.warn({ err: error }, "queue depth poll failed");
    }
  };
  void pollDepth();
  const depthTimer = setInterval(() => void pollDepth(), 15_000);

  // Prometheus endpoint (workers has no HTTP server otherwise).
  const metricsServer = http.createServer((req, res) => {
    if (req.url !== "/metrics") {
      res.writeHead(404).end();
      return;
    }
    if (!bearerMatches(req.headers.authorization, env.INTERNAL_SERVICE_SECRET)) {
      res.writeHead(401).end("unauthorized");
      return;
    }
    void renderMetrics(metrics.registry).then(({ contentType, body }) => {
      res.writeHead(200, { "content-type": contentType });
      res.end(body);
    });
  });
  metricsServer.listen(env.METRICS_PORT, () => {
    log.info({ port: env.METRICS_PORT }, "metrics endpoint listening");
  });

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info({ signal }, "shutting down — finishing in-flight jobs");
    void (async () => {
      try {
        clearInterval(depthTimer);
        metricsServer.close();
        await worker.close(); // waits for active jobs
        await queue.close();
        await connection.quit();
        await closeDb();
        await tracing.shutdown();
        await sentry.flush();
        process.exit(0);
      } catch (error) {
        log.error({ err: error }, "shutdown failed");
        process.exit(1);
      }
    })();
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  log.info(
    {
      queue: NOTIFICATIONS_QUEUE,
      concurrency: env.WORKER_CONCURRENCY,
      whatsappConfigured: whatsapp.configured,
      tracing: tracing.enabled,
    },
    "workers listening",
  );
}

main().catch((error: unknown) => {
  console.error("workers failed to start:", error);
  process.exit(1);
});

import { Worker } from "bullmq";
import { config } from "dotenv";
import { Redis } from "ioredis";
import { jobPayloadSchema, NOTIFICATIONS_QUEUE } from "@vaanidesk/shared";
import { createDal, createDatabase } from "@vaanidesk/db";
import { handleMissedCallCallback } from "./callbacks.js";
import { loadEnv } from "./env.js";
import { handleNotificationJob, type HandlerDeps } from "./handlers.js";
import { createLogger } from "./logger.js";
import { createS3Client, handleRecordingMigration } from "./recordings.js";
import { createWhatsappClient } from "./whatsapp/client.js";

config({ path: "../../.env" });
config();

function main(): void {
  const env = loadEnv();
  const log = createLogger(env);
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

  const worker = new Worker(
    NOTIFICATIONS_QUEUE,
    async (job) => {
      // Version-skew safety: an unrecognized payload fails visibly, not weirdly.
      const parsed = jobPayloadSchema.safeParse(job.data);
      if (!parsed.success) {
        log.error({ jobId: job.id, issues: parsed.error.issues }, "invalid job payload — dropping");
        return;
      }
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
    { connection, concurrency: env.WORKER_CONCURRENCY },
  );

  worker.on("failed", (job, error) => {
    log.error(
      { jobId: job?.id, attempts: job?.attemptsMade, err: error },
      "job failed (will retry per backoff policy until attempts exhausted)",
    );
  });
  worker.on("error", (error) => {
    log.error({ err: error }, "worker connection error");
  });

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info({ signal }, "shutting down — finishing in-flight jobs");
    void (async () => {
      try {
        await worker.close(); // waits for active jobs
        await connection.quit();
        await closeDb();
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
    },
    "workers listening",
  );
}

main();

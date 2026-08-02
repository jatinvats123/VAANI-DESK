import { Queue } from "bullmq";
import { Redis } from "ioredis";
import {
  NOTIFICATIONS_QUEUE,
  type EnqueueOptions,
  type JobEnqueuer,
  type JobPayload,
} from "@vaanidesk/shared";
import type { FastifyBaseLogger } from "fastify";
import { currentTraceCarrier } from "./plugins/tracing.js";

/**
 * BullMQ-backed JobEnqueuer. Honors the port contract: never throws — the
 * booking row is the source of truth and a Redis blip must not fail a booking.
 * Jobs get retries with exponential backoff; failed jobs are kept for triage.
 */
export function createJobQueues(
  redisUrl: string,
  log: FastifyBaseLogger,
): { jobs: JobEnqueuer; close: () => Promise<void> } {
  // BullMQ requires maxRetriesPerRequest: null on its connections.
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
  const queue = new Queue<JobPayload>(NOTIFICATIONS_QUEUE, {
    connection,
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: "exponential", delay: 5_000 },
      removeOnComplete: { age: 24 * 3600, count: 1000 },
      removeOnFail: { age: 7 * 24 * 3600 },
    },
  });

  const jobs: JobEnqueuer = {
    async enqueue(payload: JobPayload, options: EnqueueOptions): Promise<void> {
      try {
        // Forward the request's trace context so the worker's job joins the same
        // trace. Reserved __-prefixed keys; jobPayloadSchema strips them on parse.
        // Empty when tracing is off.
        const trace = currentTraceCarrier() ?? {};
        await queue.add(
          payload.type,
          { ...payload, ...(Object.keys(trace).length > 0 ? { __trace: trace } : {}) },
          {
            jobId: options.jobId,
            ...(options.delayMs !== undefined ? { delay: options.delayMs } : {}),
          },
        );
      } catch (error) {
        log.error({ err: error, jobId: options.jobId, type: payload.type }, "enqueue failed");
      }
    },

    async remove(jobId: string): Promise<void> {
      try {
        await queue.remove(jobId);
      } catch (error) {
        log.warn({ err: error, jobId }, "job remove failed");
      }
    },
  };

  return {
    jobs,
    close: async () => {
      await queue.close();
      await connection.quit();
    },
  };
}

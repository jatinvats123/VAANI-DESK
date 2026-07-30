import type { Dal, Database } from "@vaanidesk/db";
import type { JobEnqueuer } from "@vaanidesk/shared";
import type { Redis } from "ioredis";
import type { Env } from "./env.js";

/**
 * Everything the server needs, constructed once in the entrypoint and threaded
 * through explicitly — no module-level singletons, so tests can inject fakes
 * and two servers can coexist in one process.
 */
export interface AppDeps {
  env: Env;
  db: Database;
  dal: Dal;
  /** Shared connection for commands and rate limiting. */
  redis: Redis;
  /**
   * Factory for dedicated subscriber connections — a Redis connection in
   * subscribe mode cannot issue commands, so each WS client gets its own.
   */
  createSubscriber: () => Redis;
  /** Notification job producer (BullMQ in prod, NULL_ENQUEUER in tests). */
  jobs: JobEnqueuer;
}

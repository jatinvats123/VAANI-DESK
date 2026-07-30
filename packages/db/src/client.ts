import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index.js";

export interface CreateDatabaseOptions {
  /** Pool size. API replicas: ~10; workers: ~5; scripts: 1. */
  max?: number;
}

export function createDatabase(connectionString: string, options: CreateDatabaseOptions = {}) {
  const sql = postgres(connectionString, {
    max: options.max ?? 10,
    // Neon closes idle connections aggressively; keep local behavior aligned.
    idle_timeout: 30,
    onnotice: () => {},
  });
  const db = drizzle(sql, { schema });
  return {
    db,
    /** Graceful shutdown — drains the pool. */
    close: () => sql.end({ timeout: 5 }),
  };
}

export type Database = ReturnType<typeof createDatabase>["db"];

/**
 * Either the root database handle or a transaction handle — repository methods
 * accept both so multi-step invariants (availability re-check + insert) can run
 * atomically without repositories knowing about transaction management.
 */
export type DbExecutor = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];

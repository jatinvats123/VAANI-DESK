import "server-only";
import { createDal, createDatabase, type Dal, type Database } from "@vaanidesk/db";

/**
 * One pool per server process, HMR-safe in dev. Web reads/writes domain data
 * through the api (single writer, ADR-0002) — this direct handle exists only
 * for Auth.js (adapter + session lookups share the api's `sessions` table).
 */

interface DbGlobal {
  __vdDb?: { db: Database; dal: Dal; close: () => Promise<void> };
}

function connect() {
  const url = process.env.DATABASE_URL ?? "postgres://vaanidesk:vaanidesk@localhost:5432/vaanidesk";
  const { db, close } = createDatabase(url, { max: 5 });
  return { db, dal: createDal(db), close };
}

const globalRef = globalThis as DbGlobal;

export function getDb(): { db: Database; dal: Dal } {
  globalRef.__vdDb ??= connect();
  return globalRef.__vdDb;
}

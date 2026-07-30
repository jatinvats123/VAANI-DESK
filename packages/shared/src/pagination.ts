import { z } from "zod";
import { err, ok, type Result } from "./result.js";

/**
 * Opaque cursor pagination for /v1 list endpoints. Cursors encode the sort key
 * and row id of the last item; they are validated on decode so a tampered or
 * stale cursor degrades to a clean validation error, never a 500.
 */

const cursorSchema = z.object({
  /** Sort-key value of the last row (ISO timestamp or comparable string). */
  k: z.string(),
  /** Row id tiebreaker for stable ordering. */
  id: z.string(),
});

export type Cursor = z.infer<typeof cursorSchema>;

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeCursor(encoded: string): Result<Cursor, string> {
  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    return err("Malformed pagination cursor");
  }
  const parsed = cursorSchema.safeParse(json);
  return parsed.success ? ok(parsed.data) : err("Invalid pagination cursor");
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

/**
 * Build a page from rows fetched with `limit + 1` (the sentinel row proves there
 * is a next page without a count query).
 */
export function buildPage<T>(rows: T[], limit: number, toCursor: (row: T) => Cursor): Page<T> {
  if (rows.length <= limit) {
    return { items: rows, nextCursor: null };
  }
  const items = rows.slice(0, limit);
  const last = items[items.length - 1];
  return { items, nextCursor: last ? encodeCursor(toCursor(last)) : null };
}

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

export const pageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  cursor: z.string().optional(),
});

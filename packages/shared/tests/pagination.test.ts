import { describe, expect, it } from "vitest";
import { buildPage, decodeCursor, encodeCursor } from "../src/pagination.js";

describe("cursor encoding", () => {
  it("round-trips", () => {
    const cursor = { k: "2026-07-17T10:00:00.000Z", id: "abc-123" };
    const decoded = decodeCursor(encodeCursor(cursor));
    expect(decoded.ok).toBe(true);
    if (decoded.ok) expect(decoded.value).toEqual(cursor);
  });

  it("rejects garbage and tampered cursors", () => {
    expect(decodeCursor("not-base64url!!!").ok).toBe(false);
    expect(decodeCursor(Buffer.from('{"nope":1}').toString("base64url")).ok).toBe(false);
    expect(decodeCursor("").ok).toBe(false);
  });
});

describe("buildPage", () => {
  const toCursor = (row: { id: string; at: string }) => ({ k: row.at, id: row.id });

  it("returns no cursor when rows fit the limit", () => {
    const rows = [{ id: "1", at: "a" }];
    expect(buildPage(rows, 25, toCursor)).toEqual({ items: rows, nextCursor: null });
  });

  it("trims the sentinel row and emits a cursor pointing at the last item", () => {
    const rows = [
      { id: "1", at: "a" },
      { id: "2", at: "b" },
      { id: "3", at: "c" },
    ];
    const page = buildPage(rows, 2, toCursor);
    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).not.toBeNull();
    const decoded = decodeCursor(page.nextCursor!);
    expect(decoded.ok && decoded.value).toEqual({ k: "b", id: "2" });
  });
});

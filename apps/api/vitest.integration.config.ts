import { defineConfig } from "vitest/config";

// Integration tests run against a real Postgres (testcontainers or
// TEST_DATABASE_URL) — separate task, excluded from the default unit run.
export default defineConfig({
  test: {
    include: ["tests/integration/**/*.test.ts"],
    testTimeout: 120_000,
    hookTimeout: 180_000,
    // One file at a time — container lifecycle owns the database.
    fileParallelism: false,
  },
});

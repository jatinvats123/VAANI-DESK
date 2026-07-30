import { defineConfig } from "@playwright/test";

/**
 * E2E happy paths against the real stack. Prereqs: docker compose infra up and
 * migrations applied (`pnpm db:migrate`). Auth is seeded straight into the
 * shared sessions table by global-setup — no email/OAuth dependency in CI.
 * `reuseExistingServer` lets you run against already-running dev servers.
 */
export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: "http://localhost:3000",
    storageState: "e2e/.auth/state.json",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "pnpm --filter @vaanidesk/api dev",
      url: "http://localhost:4000/healthz",
      cwd: "../..",
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      command: "pnpm dev",
      url: "http://localhost:3000",
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
});

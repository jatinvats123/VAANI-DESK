import * as Sentry from "@sentry/nextjs";
// Import the scrubber via its own subpath, not the package barrel — the barrel
// pulls node:crypto (slug.ts), which the edge/client bundle can't resolve.
import { scrubPII } from "@vaanidesk/shared/pii";

/**
 * Server + edge error tracking for the dashboard. Loaded automatically by Next
 * (instrumentation hook). Feature-flagged on `SENTRY_DSN` — with no DSN,
 * `Sentry.init` produces a disabled client that sends nothing, so local and
 * demo runs are unaffected.
 *
 * Every outbound event runs through `scrubPII` (the same secret/phone scrubbing
 * as the api's pino redaction and the Node services' Sentry init), so session
 * cookies and caller numbers never leave the process.
 */
export function register(): void {
  const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;
  const common = {
    dsn,
    environment: process.env.NODE_ENV,
    ...(process.env.SENTRY_RELEASE !== undefined ? { release: process.env.SENTRY_RELEASE } : {}),
    tracesSampleRate: 0,
    sendDefaultPii: false,
    beforeSend: (event: Sentry.ErrorEvent) => scrubPII(event),
  };

  if (process.env.NEXT_RUNTIME === "nodejs") {
    Sentry.init({ ...common, initialScope: { tags: { service: "web", runtime: "node" } } });
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    Sentry.init({ ...common, initialScope: { tags: { service: "web", runtime: "edge" } } });
  }
}

// Reports errors thrown in server components, route handlers, and server
// actions through the initialized (and scrubbing) client.
export const onRequestError = Sentry.captureRequestError;

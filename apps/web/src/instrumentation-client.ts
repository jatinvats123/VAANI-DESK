import * as Sentry from "@sentry/nextjs";
// Subpath import (not the barrel) keeps node:crypto out of the client bundle.
import { scrubPII } from "@vaanidesk/shared/pii";

/**
 * Browser error tracking for the dashboard. Loaded automatically by Next.
 * Disabled unless `NEXT_PUBLIC_SENTRY_DSN` is set at build time. Perf tracing
 * off; every event is PII-scrubbed before send, consistent with the server side.
 */
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV,
  ...(process.env.NEXT_PUBLIC_SENTRY_RELEASE !== undefined
    ? { release: process.env.NEXT_PUBLIC_SENTRY_RELEASE }
    : {}),
  tracesSampleRate: 0,
  sendDefaultPii: false,
  beforeSend: (event) => scrubPII(event),
});

// Instruments client-side navigations for error context.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;

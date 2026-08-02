import * as Sentry from "@sentry/node";
import { scrubPII } from "@vaanidesk/shared";

/**
 * Error tracking for the Node services (api, gateway, workers). Feature-flagged
 * on `SENTRY_DSN`: unset → a clean no-op (`Sentry.captureException` is itself a
 * no-op when init never ran), so local and demo runs send nothing.
 *
 * Tracing is owned by our OpenTelemetry SDK (ADR-0008), so Sentry is configured
 * for errors only: `skipOpenTelemetrySetup` stops it from registering its own
 * OTel context manager / propagators and clobbering ours, and perf sampling is
 * off. Every outbound event passes through `scrubPII` — the same secret/phone
 * scrubbing as the pino log redaction.
 */

export interface SentryHandle {
  readonly enabled: boolean;
  /** Flush queued events before the process exits. */
  flush(): Promise<void>;
}

export function initSentry(
  service: "api" | "voice-gateway" | "workers",
  options: { dsn?: string; environment: string; release?: string },
): SentryHandle {
  const { dsn, environment, release } = options;
  if (!dsn) return { enabled: false, flush: () => Promise.resolve() };

  Sentry.init({
    dsn,
    environment,
    ...(release !== undefined ? { release } : {}),
    skipOpenTelemetrySetup: true,
    tracesSampleRate: 0,
    // We attach nothing sensitive on purpose; beforeSend is the final guard.
    sendDefaultPii: false,
    initialScope: { tags: { service } },
    beforeSend: (event) => scrubPII(event),
    beforeSendTransaction: (event) => scrubPII(event),
  });

  return {
    enabled: true,
    flush: async () => {
      await Sentry.flush(2000);
    },
  };
}

/** Re-exported so services capture errors without a direct @sentry/node dep. */
export { Sentry };

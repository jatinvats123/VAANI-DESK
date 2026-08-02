import { parseEnv, portSchema } from "@vaanidesk/shared";
import { z } from "zod";

export function loadEnv(source: Record<string, string | undefined> = process.env) {
  return parseEnv(
    {
      NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
      LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error"]).default("info"),

      /** OTLP/HTTP collector base URL. Unset = tracing disabled (no-op). */
      OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
      /** Sentry DSN. Unset = error tracking disabled (no-op). */
      SENTRY_DSN: z.string().url().optional(),
      /** Release identifier tagged on Sentry events (e.g. git sha). */
      SENTRY_RELEASE: z.string().optional(),

      GATEWAY_PORT: portSchema.default(4100),
      GATEWAY_HOST: z.string().default("0.0.0.0"),

      /** Internal api base URL + the shared service secret (ADR-0004). */
      API_BASE_URL: z.string().url().default("http://localhost:4000"),
      INTERNAL_SERVICE_SECRET: z.string().min(16),

      REDIS_URL: z.string().url().default("redis://localhost:6379"),

      DEEPGRAM_API_KEY: z.string().min(1),
      DEEPGRAM_MODEL: z.string().default("nova-3"),

      ANTHROPIC_API_KEY: z.string().min(1),
      AGENT_MODEL: z.string().default("claude-haiku-4-5-20251001"),

      ELEVENLABS_API_KEY: z.string().min(1),
      ELEVENLABS_VOICE_ID: z.string().min(1),
      ELEVENLABS_MODEL: z.string().default("eleven_flash_v2_5"),

      /** Active calls get this long to finish after SIGTERM before forced end. */
      DRAIN_TIMEOUT_MS: z.coerce
        .number()
        .int()
        .min(1000)
        .default(5 * 60 * 1000),
      /** Caller silence before a re-prompt (then the budget reducer decides). */
      SILENCE_TIMEOUT_MS: z.coerce.number().int().min(1000).default(12_000),
      /** Hard cap on total call duration. */
      MAX_CALL_DURATION_MS: z.coerce
        .number()
        .int()
        .min(60_000)
        .default(15 * 60 * 1000),
    },
    source,
  );
}

export type Env = ReturnType<typeof loadEnv>;

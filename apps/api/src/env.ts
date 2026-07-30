import { parseEnv, portSchema } from "@vaanidesk/shared";
import { z } from "zod";

/**
 * Loaded once at startup by the entrypoint and passed down through AppDeps —
 * modules never read process.env directly, so tests construct configs freely.
 */
export function loadEnv(source: Record<string, string | undefined> = process.env) {
  return parseEnv(
    {
      NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
      LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error"]).default("info"),

      DATABASE_URL: z
        .string()
        .url()
        .default("postgres://vaanidesk:vaanidesk@localhost:5432/vaanidesk"),
      REDIS_URL: z.string().url().default("redis://localhost:6379"),

      API_PORT: portSchema.default(4000),
      API_HOST: z.string().default("0.0.0.0"),
      /** Public HTTPS origin Twilio calls — signatures are computed over it. */
      PUBLIC_API_URL: z.string().url().default("http://localhost:4000"),
      /** Dashboard origin for CORS with credentials. */
      WEB_ORIGIN: z.string().url().default("http://localhost:3000"),

      /** Shared secret authenticating the voice gateway on /v1/internal/*. */
      INTERNAL_SERVICE_SECRET: z.string().min(16),

      /** Auth.js database-session cookie (web and api share the sessions table). */
      AUTH_COOKIE_NAME: z.string().default("authjs.session-token"),

      TELEPHONY_PROVIDER: z.enum(["twilio", "exotel"]).default("twilio"),
      TWILIO_ACCOUNT_SID: z.string().optional(),
      TWILIO_AUTH_TOKEN: z.string().optional(),
      /** Shared token Exotel appends to webhook URLs (no HMAC support). */
      EXOTEL_WEBHOOK_TOKEN: z.string().optional(),
      /**
       * "enforce" rejects webhooks with bad/missing signatures (production).
       * "log" accepts but logs loudly — local development against ngrok only.
       */
      WEBHOOK_SIGNATURE_MODE: z.enum(["enforce", "log"]).default("enforce"),

      /** wss:// endpoint the TwiML <Stream> connects the call's media to. */
      GATEWAY_STREAM_URL: z.string().default("wss://localhost:4100/stream"),

      /** WhatsApp Cloud API webhook credentials (Meta app dashboard). */
      WHATSAPP_APP_SECRET: z.string().optional(),
      WHATSAPP_WEBHOOK_VERIFY_TOKEN: z.string().optional(),

      /** Private recordings bucket — playback URLs are signed, never public. */
      S3_ENDPOINT: z.string().optional(),
      S3_REGION: z.string().default("ap-south-1"),
      S3_BUCKET: z.string().default("vaanidesk-recordings"),
      S3_ACCESS_KEY_ID: z.string().optional(),
      S3_SECRET_ACCESS_KEY: z.string().optional(),
    },
    source,
  );
}

export type Env = ReturnType<typeof loadEnv>;

import { parseEnv } from "@vaanidesk/shared";
import { z } from "zod";

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

      WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(50).default(5),

      /** Port for the Prometheus /metrics endpoint (service-secret guarded). */
      METRICS_PORT: z.coerce.number().int().min(1).max(65535).default(9095),

      /** Missed-call callbacks go through the api (it owns telephony REST). */
      API_BASE_URL: z.string().url().default("http://localhost:4000"),
      INTERNAL_SERVICE_SECRET: z.string().min(16),

      /**
       * WhatsApp Cloud API. Optional so local stacks run without Meta creds —
       * jobs then complete as "skipped" (audited), never silently mocked.
       */
      WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
      WHATSAPP_ACCESS_TOKEN: z.string().optional(),
      WHATSAPP_GRAPH_VERSION: z.string().default("v21.0"),
      /** Pre-approved template names in the WhatsApp manager. */
      WHATSAPP_TEMPLATE_CONFIRMATION: z.string().default("vd_booking_confirmation"),
      WHATSAPP_TEMPLATE_REMINDER: z.string().default("vd_booking_reminder"),
      WHATSAPP_TEMPLATE_CANCELLATION: z.string().default("vd_booking_cancellation"),
      WHATSAPP_TEMPLATE_LANGUAGE: z.string().default("en"),

      /** For fetching provider-hosted recordings (basic auth). */
      TWILIO_ACCOUNT_SID: z.string().optional(),
      TWILIO_AUTH_TOKEN: z.string().optional(),

      /** Private recordings bucket. Optional locally — migration jobs then no-op. */
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

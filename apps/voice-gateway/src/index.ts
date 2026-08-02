import { createMetrics, initSentry, initTracing } from "@vaanidesk/observability";
import { config } from "dotenv";
import { Redis } from "ioredis";
import { InternalApiClient } from "./api-client.js";
import { loadEnv } from "./env.js";
import { createLogger } from "./logger.js";
import { createLlmClient } from "./providers/factory.js";
import { createDeepgramStream } from "./providers/stt.js";
import { createElevenLabsSession } from "./providers/tts.js";
import { createGatewayServer } from "./server.js";

config({ path: "../../.env" });
config();

async function main(): Promise<void> {
  const env = loadEnv();
  const log = createLogger(env);
  // Errors first. No-op without a DSN.
  const sentry = initSentry("voice-gateway", {
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    release: env.SENTRY_RELEASE,
  });
  // Must run before any span is created. No-op unless an OTLP endpoint is set.
  const tracing = await initTracing("voice-gateway", env.OTEL_EXPORTER_OTLP_ENDPOINT);
  const redis = new Redis(env.REDIS_URL);
  const api = new InternalApiClient(env.API_BASE_URL, env.INTERNAL_SERVICE_SECRET);
  const { client: llm, provider: llmProvider, model } = createLlmClient(env);
  const metrics = createMetrics("voice-gateway");

  const gateway = createGatewayServer({
    env,
    agentModel: model, // resolved by the factory; flows to cost + metrics
    log,
    metrics,
    api,
    publishRaw: (channel, message) => {
      redis.publish(channel, message).catch((error: unknown) => {
        log.warn({ err: error }, "live event publish failed");
      });
    },
    llm,
    createStt: (events) =>
      createDeepgramStream(
        { apiKey: env.DEEPGRAM_API_KEY, model: env.DEEPGRAM_MODEL },
        events,
        log,
      ),
    createTts: (events) =>
      createElevenLabsSession(
        {
          apiKey: env.ELEVENLABS_API_KEY,
          voiceId: env.ELEVENLABS_VOICE_ID,
          model: env.ELEVENLABS_MODEL,
        },
        events,
        log,
      ),
  });

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info({ signal }, "shutdown requested");
    void gateway
      .shutdown()
      .then(async () => {
        await tracing.shutdown();
        await sentry.flush();
        await redis.quit();
        process.exit(0);
      })
      .catch((error: unknown) => {
        log.error({ err: error }, "shutdown failed");
        process.exit(1);
      });
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  gateway.server.listen(env.GATEWAY_PORT, env.GATEWAY_HOST, () => {
    log.info(
      {
        port: env.GATEWAY_PORT,
        provider: llmProvider,
        model,
        stt: env.DEEPGRAM_MODEL,
        tracing: tracing.enabled,
      },
      "voice gateway listening",
    );
  });
}

main().catch((error: unknown) => {
  console.error("voice gateway failed to start:", error);
  process.exit(1);
});

import { config } from "dotenv";
import { Redis } from "ioredis";
import { InternalApiClient } from "./api-client.js";
import { loadEnv } from "./env.js";
import { createLogger } from "./logger.js";
import { createAnthropicClient } from "./providers/llm.js";
import { createDeepgramStream } from "./providers/stt.js";
import { createElevenLabsSession } from "./providers/tts.js";
import { createGatewayServer } from "./server.js";

config({ path: "../../.env" });
config();

function main(): void {
  const env = loadEnv();
  const log = createLogger(env);
  const redis = new Redis(env.REDIS_URL);
  const api = new InternalApiClient(env.API_BASE_URL, env.INTERNAL_SERVICE_SECRET);
  const llm = createAnthropicClient({ apiKey: env.ANTHROPIC_API_KEY, model: env.AGENT_MODEL });

  const gateway = createGatewayServer({
    env,
    log,
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
      { port: env.GATEWAY_PORT, model: env.AGENT_MODEL, stt: env.DEEPGRAM_MODEL },
      "voice gateway listening",
    );
  });
}

main();

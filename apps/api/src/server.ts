import { randomUUID } from "node:crypto";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import formbody from "@fastify/formbody";
import rateLimit from "@fastify/rate-limit";
import websocket from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import type { AppDeps } from "./context.js";
import { createAuthGuards } from "./plugins/auth.js";
import { registerErrorHandling } from "./plugins/error-handler.js";
import { registerMetrics } from "./plugins/metrics.js";
import { registerTracing } from "./plugins/tracing.js";
import { registerAvailabilityRoutes } from "./modules/availability/routes.js";
import { registerBookingRoutes } from "./modules/bookings/routes.js";
import { registerBusinessRoutes } from "./modules/businesses/routes.js";
import { registerCallRoutes } from "./modules/calls/routes.js";
import { registerHealthRoutes } from "./modules/health/routes.js";
import { registerInternalRoutes } from "./modules/internal/routes.js";
import { registerResourceRoutes } from "./modules/resources/routes.js";
import { registerServiceRoutes } from "./modules/services/routes.js";
import { registerExotelWebhooks } from "./modules/webhooks/exotel.js";
import { registerTelephonyWebhooks } from "./modules/webhooks/telephony.js";
import { registerWhatsappWebhooks } from "./modules/webhooks/whatsapp.js";
import { registerLiveCallsWs } from "./ws/live-calls.js";
import rawBody from "fastify-raw-body";

export async function buildServer(deps: AppDeps): Promise<FastifyInstance> {
  const { env } = deps;

  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      ...(env.NODE_ENV === "development"
        ? { transport: { target: "pino-pretty", options: { colorize: true } } }
        : {}),
      redact: {
        paths: ["req.headers.authorization", "req.headers.cookie"],
        censor: "[redacted]",
      },
    },
    genReqId: () => randomUUID(),
    trustProxy: true,
    bodyLimit: 1024 * 1024,
  });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerErrorHandling(app);

  await app.register(cookie);
  await app.register(cors, { origin: env.WEB_ORIGIN, credentials: true });
  await app.register(formbody); // Twilio webhooks are urlencoded
  // Raw body only where a signature is computed over it (WhatsApp webhook).
  await app.register(rawBody, { global: false, field: "rawBody", encoding: "utf8" });
  await app.register(websocket);
  await app.register(rateLimit, {
    max: 300,
    timeWindow: "1 minute",
    redis: deps.redis,
    nameSpace: "vd-rl:",
    // Signature-verified webhooks and the service-token surface have their own
    // auth; rate limiting them would let an attacker starve real telephony.
    allowList: (request) =>
      request.url.startsWith("/webhooks/") ||
      request.url.startsWith("/v1/internal/") ||
      request.url === "/healthz" ||
      request.url === "/readyz" ||
      request.url === "/metrics",
  });

  const guards = createAuthGuards(deps);

  registerTracing(app); // first, so every request runs under its trace context
  registerMetrics(app, deps);
  registerHealthRoutes(app, deps);
  registerBusinessRoutes(app, deps, guards);
  registerServiceRoutes(app, deps, guards);
  registerResourceRoutes(app, deps, guards);
  registerAvailabilityRoutes(app, deps, guards);
  registerBookingRoutes(app, deps, guards);
  registerCallRoutes(app, deps, guards);
  registerInternalRoutes(app, deps, guards);
  registerTelephonyWebhooks(app, deps);
  registerExotelWebhooks(app, deps);
  registerWhatsappWebhooks(app, deps);
  registerLiveCallsWs(app, deps, guards);

  return app;
}

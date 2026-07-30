import { pino, type Logger } from "pino";
import type { Env } from "./env.js";

export function createLogger(env: Env): Logger {
  return pino({
    level: env.LOG_LEVEL,
    ...(env.NODE_ENV === "development"
      ? { transport: { target: "pino-pretty", options: { colorize: true } } }
      : {}),
    base: { service: "workers" },
  });
}

export type { Logger };

import http from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { liveCallsChannel, serializeLiveCallEvent, type LiveCallEvent } from "@vaanidesk/shared";
import type { InternalApiClient } from "./api-client.js";
import { CallSession, newConnectionId, type SessionDeps } from "./call/session.js";
import type { Env } from "./env.js";
import type { Logger } from "./logger.js";
import type { LlmClient } from "./providers/llm.js";
import type { SttEvents, SttStream } from "./providers/stt.js";
import type { TtsEvents, TtsSession } from "./providers/tts.js";
import { extractStreamStart, parseTwilioMessage } from "./telephony/twilio-media.js";

export interface GatewayDeps {
  env: Env;
  log: Logger;
  api: InternalApiClient;
  /** Publishes a serialized live event onto a Redis channel. */
  publishRaw: (channel: string, message: string) => void;
  llm: LlmClient;
  createStt: (events: SttEvents) => SttStream;
  createTts: (events: TtsEvents) => TtsSession;
}

export interface GatewayServer {
  server: http.Server;
  activeCallCount: () => number;
  /** Stop accepting calls, drain active ones, then resolve. */
  shutdown: () => Promise<void>;
}

const MAX_QUEUED_MEDIA_FRAMES = 250; // ~5s of 20ms frames while context loads

export function createGatewayServer(deps: GatewayDeps): GatewayServer {
  const { env, log } = deps;
  const sessions = new Set<CallSession>();
  let draining = false;

  const server = http.createServer((req, res) => {
    if (req.url === "/healthz") {
      res.writeHead(draining ? 503 : 200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: draining ? "draining" : "ok", activeCalls: sessions.size }));
      return;
    }
    res.writeHead(404).end();
  });

  const wss = new WebSocketServer({ server, path: "/stream" });

  wss.on("connection", (ws: WebSocket) => {
    if (draining) {
      ws.close(1013, "draining"); // Try Again Later
      return;
    }
    const connLog = log.child({ conn: newConnectionId() });
    connLog.info("media stream connected");

    let session: CallSession | undefined;
    let starting = false;
    const queuedMedia: string[] = [];

    ws.on("message", (data: Buffer) => {
      const parsed = parseTwilioMessage(data.toString());
      if (!parsed.ok) {
        connLog.warn({ error: parsed.error }, "unparseable twilio message");
        return;
      }
      const message = parsed.value;

      switch (message.event) {
        case "connected":
          return;

        case "start": {
          if (session || starting) return;
          starting = true;
          const start = extractStreamStart(message);
          void (async () => {
            try {
              const provider =
                message.start.customParameters["provider"] === "exotel" ? "exotel" : "twilio";
              const context = await deps.api.getCallContext(provider, start.providerCallSid);
              const sessionDeps: SessionDeps = {
                env,
                log: connLog,
                api: deps.api,
                publish: (event: LiveCallEvent) =>
                  deps.publishRaw(
                    liveCallsChannel(event.businessId),
                    serializeLiveCallEvent(event),
                  ),
                createStt: deps.createStt,
                createTts: deps.createTts,
                llm: deps.llm,
                sendToTwilio: (raw) => {
                  if (ws.readyState === ws.OPEN) ws.send(raw);
                },
                closeTwilio: () => ws.close(1000, "call complete"),
              };
              const created = new CallSession(sessionDeps, context, start.streamSid);
              sessions.add(created);
              session = created;
              await created.begin();
              for (const frame of queuedMedia) created.onMediaPayload(frame);
              queuedMedia.length = 0;
            } catch (error) {
              connLog.error({ err: error, callSid: start.providerCallSid }, "session setup failed");
              ws.close(1011, "setup failed");
            }
          })();
          return;
        }

        case "media":
          if (session) session.onMediaPayload(message.media.payload);
          else if (queuedMedia.length < MAX_QUEUED_MEDIA_FRAMES)
            queuedMedia.push(message.media.payload);
          return;

        case "mark":
          session?.onMark(message.mark.name);
          return;

        case "dtmf":
          session?.onDtmf(message.dtmf.digit);
          return;

        case "stop":
          void session?.onStop();
          return;
      }
    });

    ws.on("close", () => {
      connLog.info("media stream closed");
      if (session) {
        const closing = session;
        void closing.onSocketClosed().finally(() => sessions.delete(closing));
      }
    });

    ws.on("error", (error: Error) => {
      connLog.error({ err: error }, "media websocket error");
    });
  });

  return {
    server,
    activeCallCount: () => sessions.size,

    async shutdown(): Promise<void> {
      draining = true;
      log.info({ activeCalls: sessions.size }, "draining");
      const deadline = Date.now() + env.DRAIN_TIMEOUT_MS;
      while (sessions.size > 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      if (sessions.size > 0) {
        log.warn({ remaining: sessions.size }, "drain timeout — forcing call end");
        await Promise.allSettled([...sessions].map((s) => s.forceEnd()));
      }
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}

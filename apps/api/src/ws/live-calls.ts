import { liveCallsChannel, parseLiveCallEvent } from "@vaanidesk/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { WebSocket } from "ws";
import { z } from "zod";
import type { AppDeps } from "../context.js";
import type { AuthGuards } from "../plugins/auth.js";

const wsQuerySchema = z.object({ businessId: z.string().uuid() });

const HEARTBEAT_INTERVAL_MS = 30_000;

/** Close codes in the WS application range so the dashboard can distinguish. */
const WS_UNAUTHORIZED = 4401;
const WS_FORBIDDEN = 4403;
const WS_BAD_REQUEST = 4400;

/**
 * Dashboard live feed: one authenticated socket per viewer, one dedicated
 * Redis subscriber per socket (subscribe-mode connections cannot multiplex
 * commands). Membership is verified before subscribing — the channel name is
 * derived server-side, so a client can never pick another tenant's channel.
 */
export function registerLiveCallsWs(app: FastifyInstance, deps: AppDeps, guards: AuthGuards): void {
  app.get("/ws/live-calls", { websocket: true }, (socket: WebSocket, request: FastifyRequest) => {
    void handleConnection(socket, request, deps, guards).catch((error: unknown) => {
      request.log.error({ err: error }, "live-calls WS setup failed");
      socket.close(1011, "internal error");
    });
  });
}

async function handleConnection(
  socket: WebSocket,
  request: FastifyRequest,
  deps: AppDeps,
  guards: AuthGuards,
): Promise<void> {
  const query = wsQuerySchema.safeParse(request.query);
  if (!query.success) {
    socket.close(WS_BAD_REQUEST, "businessId query parameter required");
    return;
  }
  const { businessId } = query.data;

  const user = await guards.authenticateWsRequest(request, undefined as never);
  if (!user) {
    socket.close(WS_UNAUTHORIZED, "authentication required");
    return;
  }
  const membership = await deps.dal.system.memberships.get(user.id, businessId);
  if (!membership) {
    socket.close(WS_FORBIDDEN, "not a member of this business");
    return;
  }

  const subscriber = deps.createSubscriber();
  let alive = true;

  const heartbeat = setInterval(() => {
    if (!alive) {
      socket.terminate();
      return;
    }
    alive = false;
    socket.ping();
  }, HEARTBEAT_INTERVAL_MS);

  socket.on("pong", () => {
    alive = true;
  });

  subscriber.on("message", (_channel: string, message: string) => {
    // Re-validate at the fan-out boundary: only well-formed events reach browsers.
    const event = parseLiveCallEvent(message);
    if (event.ok && socket.readyState === socket.OPEN) {
      socket.send(message);
    }
  });

  const cleanup = (): void => {
    clearInterval(heartbeat);
    subscriber.disconnect();
  };
  socket.on("close", cleanup);
  socket.on("error", cleanup);

  try {
    await subscriber.subscribe(liveCallsChannel(businessId));
  } catch (error) {
    request.log.error({ err: error }, "live-calls subscribe failed");
    cleanup();
    socket.close(1011, "subscription failed");
  }
}

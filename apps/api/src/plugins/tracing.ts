import { AsyncLocalStorage } from "node:async_hooks";
import {
  extractTraceContext,
  injectTraceContext,
  startHttpServerSpan,
  type ManualSpan,
} from "@vaanidesk/observability";
import type { FastifyInstance, FastifyRequest } from "fastify";

/**
 * Request-scoped tracing for the api. On every request it:
 *  - extracts the propagated trace context from the inbound headers (the gateway
 *    sends traceparent + baggage carrying the call_id);
 *  - opens a SERVER span as a child of it, so the api appears in the call's trace;
 *  - stashes a carrier for that span in an AsyncLocalStorage, so any job enqueued
 *    while handling the request forwards the context to the workers — making one
 *    phone call a single trace across gateway → api → workers (ADR-0008).
 *
 * All of this is inert when tracing is disabled: the span is non-recording and
 * the carrier is empty, so nothing is added to job payloads or response paths.
 */

const carrierStore = new AsyncLocalStorage<Record<string, string>>();

/** The trace headers to forward with work enqueued during the current request. */
export function currentTraceCarrier(): Record<string, string> | undefined {
  return carrierStore.getStore();
}

const spans = new WeakMap<FastifyRequest, ManualSpan>();

export function registerTracing(app: FastifyInstance): void {
  app.addHook("onRequest", (request, _reply, done) => {
    const parent = extractTraceContext(request.headers);
    const span = startHttpServerSpan(request.method, parent, {
      "http.method": request.method,
      "http.target": request.url,
    });
    spans.set(request, span);
    // enterWith persists the carrier for the rest of this request's async chain,
    // including the route handler and the enqueue calls it awaits.
    carrierStore.enterWith(injectTraceContext({}, span.ctx));
    done();
  });

  app.addHook("onResponse", (request, reply, done) => {
    const span = spans.get(request);
    if (span) {
      // Route template is only known post-routing; rename off the raw path.
      span.setName(`${request.method} ${request.routeOptions.url ?? request.url}`);
      span.end(reply.statusCode);
    }
    done();
  });
}

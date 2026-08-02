import { context, propagation, trace } from "@opentelemetry/api";
import { AsyncHooksContextManager } from "@opentelemetry/context-async-hooks";
import {
  CompositePropagator,
  W3CBaggagePropagator,
  W3CTraceContextPropagator,
} from "@opentelemetry/core";
import { BasicTracerProvider } from "@opentelemetry/sdk-trace-base";
import Fastify from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { currentTraceCarrier, registerTracing } from "../src/plugins/tracing.js";

// Register the real propagators + async-context manager (no exporter — this test
// only exercises context propagation, not span export) so injection/extraction
// behave exactly as they do under the live SDK.
beforeAll(() => {
  context.setGlobalContextManager(new AsyncHooksContextManager().enable());
  propagation.setGlobalPropagator(
    new CompositePropagator({
      propagators: [new W3CTraceContextPropagator(), new W3CBaggagePropagator()],
    }),
  );
  trace.setGlobalTracerProvider(new BasicTracerProvider());
});
afterAll(() => {
  context.disable();
  trace.disable();
  propagation.disable();
});

describe("registerTracing", () => {
  it("forwards the inbound trace context to the handler (survives an await)", async () => {
    const app = Fastify();
    registerTracing(app);

    let seenInHandler: Record<string, string> | undefined;
    app.get("/probe", async () => {
      // Mirrors an enqueue happening mid-handler, after async work — this is
      // where the request-scoped carrier must still be visible.
      await Promise.resolve();
      seenInHandler = currentTraceCarrier();
      return { ok: true };
    });
    await app.ready();

    const traceId = "0af7651916cd43dd8448eb211c80319c";
    const res = await app.inject({
      method: "GET",
      url: "/probe",
      headers: { traceparent: `00-${traceId}-b7ad6b7169203331-01` },
    });

    expect(res.statusCode).toBe(200);
    // The carrier reached the handler through AsyncLocalStorage.enterWith...
    expect(seenInHandler?.traceparent).toBeDefined();
    // ...and forwards the SAME trace, so an enqueued job joins one trace.
    expect(seenInHandler?.traceparent).toContain(traceId);

    await app.close();
  });
});

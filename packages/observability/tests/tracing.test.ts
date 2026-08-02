import { context, propagation, trace } from "@opentelemetry/api";
import { AsyncHooksContextManager } from "@opentelemetry/context-async-hooks";
import {
  CompositePropagator,
  W3CBaggagePropagator,
  W3CTraceContextPropagator,
} from "@opentelemetry/core";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  CALL_ID_ATTR,
  CALL_ID_HEADER,
  callIdFromContext,
  extractTraceContext,
  initTracing,
  injectTraceContext,
  withCallId,
  withSpan,
} from "../src/tracing.js";

// Register a real (in-memory) provider so propagation round-trips exactly as it
// would in production — same API surface the OTLP SDK wires up — without a
// live collector.
const exporter = new InMemorySpanExporter();

beforeAll(() => {
  const contextManager = new AsyncHooksContextManager().enable();
  context.setGlobalContextManager(contextManager);
  propagation.setGlobalPropagator(
    new CompositePropagator({
      propagators: [new W3CTraceContextPropagator(), new W3CBaggagePropagator()],
    }),
  );
  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  trace.setGlobalTracerProvider(provider);
});

afterAll(() => {
  context.disable();
  trace.disable();
  propagation.disable();
});

describe("initTracing", () => {
  it("is a no-op when no OTLP endpoint is configured", async () => {
    const handle = await initTracing("api", undefined);
    expect(handle.enabled).toBe(false);
    await expect(handle.shutdown()).resolves.toBeUndefined();
  });
});

describe("trace + call_id propagation", () => {
  it("round-trips trace context and call_id through a carrier", async () => {
    const carrier: Record<string, string> = {};

    // The gateway pins the call_id into the context once, then spans/injects.
    const callCtx = withCallId("call_abc123");
    const injected = await withSpan(
      "gateway.call",
      {},
      () => {
        injectTraceContext(carrier);
        return trace.getActiveSpan()!.spanContext().traceId;
      },
      callCtx,
    );

    // The gateway wrote a W3C traceparent and baggage into the carrier.
    expect(carrier.traceparent).toMatch(new RegExp(`^00-${injected}-[0-9a-f]{16}-`));
    expect(carrier.baggage).toContain(encodeURIComponent(CALL_ID_ATTR));

    // Downstream (api) extracts the same trace and reads the call_id from baggage.
    const parent = extractTraceContext(carrier);
    expect(callIdFromContext(parent)).toBe("call_abc123");

    const childTraceId = await withSpan(
      "api.handle",
      {},
      () => trace.getActiveSpan()!.spanContext().traceId,
      parent,
    );
    expect(childTraceId).toBe(injected); // one call = one trace, end to end
  });

  it("records the call_id as a span attribute and marks errors", async () => {
    exporter.reset();
    await expect(
      withSpan(
        "worker.job",
        {},
        () => {
          throw new Error("boom");
        },
        withCallId("call_err"),
      ),
    ).rejects.toThrow("boom");

    const [span] = exporter.getFinishedSpans();
    expect(span?.attributes[CALL_ID_ATTR]).toBe("call_err");
    expect(span?.status.code).toBe(2 /* SpanStatusCode.ERROR */);
  });
});

describe("constants", () => {
  it("exposes the call-id header name", () => {
    expect(CALL_ID_HEADER).toBe("x-vaanidesk-call-id");
  });
});

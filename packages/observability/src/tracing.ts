import {
  context,
  propagation,
  SpanStatusCode,
  trace,
  type Context,
  type Span,
} from "@opentelemetry/api";

/**
 * OpenTelemetry tracing, feature-flagged. Tracing is fully real (spans recorded
 * and exported over OTLP, W3C context + baggage propagation active) whenever
 * `OTEL_EXPORTER_OTLP_ENDPOINT` is set. When it is not, `initTracing` is a clean
 * no-op: `getTracer()` returns the API's no-op tracer, and inject/extract use
 * the no-op propagator — zero cost, zero behaviour change, so the demo path is
 * never at risk.
 *
 * The goal (Phase 3 / ADR-0008): one phone call is one trace end to end, with a
 * `call_id` propagated gateway → api → workers. Propagation is explicit (no
 * auto-instrumentation) because the services run under `tsx`, where monkeypatch
 * instrumentation + ESM loading is fragile.
 */

/** Header the gateway sets so downstream logs/traces can be filtered by call. */
export const CALL_ID_HEADER = "x-vaanidesk-call-id";
/** Span/baggage attribute key for the call id. */
export const CALL_ID_ATTR = "vaanidesk.call_id";

const TRACER_NAME = "vaanidesk";

export interface TracingHandle {
  shutdown: () => Promise<void>;
  readonly enabled: boolean;
}

/**
 * Start the Node OTel SDK when an OTLP endpoint is configured. Call once at
 * process start, before serving traffic. Safe to call when disabled.
 */
export async function initTracing(
  serviceName: string,
  endpoint: string | undefined,
): Promise<TracingHandle> {
  if (!endpoint) return { shutdown: () => Promise.resolve(), enabled: false };

  // Dynamic imports keep the heavy SDK out of the process unless tracing is on.
  const [{ NodeSDK }, { OTLPTraceExporter }, { resourceFromAttributes }, semconv] =
    await Promise.all([
      import("@opentelemetry/sdk-node"),
      import("@opentelemetry/exporter-trace-otlp-http"),
      import("@opentelemetry/resources"),
      import("@opentelemetry/semantic-conventions"),
    ]);

  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [semconv.ATTR_SERVICE_NAME]: `vaanidesk-${serviceName}`,
    }),
    traceExporter: new OTLPTraceExporter({ url: `${endpoint.replace(/\/$/, "")}/v1/traces` }),
  });
  sdk.start(); // registers global tracer provider, W3C propagators, async-hooks context
  return { shutdown: () => sdk.shutdown(), enabled: true };
}

export function getTracer() {
  return trace.getTracer(TRACER_NAME);
}

/** Inject a trace context (traceparent + baggage) into an outgoing carrier. */
export function injectTraceContext(
  carrier: Record<string, string>,
  ctx: Context = context.active(),
): Record<string, string> {
  propagation.inject(ctx, carrier);
  return carrier;
}

/** Extract a parent trace context from an incoming carrier (headers or job data). */
export function extractTraceContext(
  carrier: Record<string, string | string[] | undefined>,
): Context {
  return propagation.extract(context.active(), carrier);
}

/**
 * Derive a new context carrying `callId` in baggage. OTel contexts are
 * immutable, so this returns a fresh context — the caller must make it active
 * (e.g. via `withSpan`'s parent argument, or `context.with`) for the id to
 * propagate. The gateway does this once per call so every downstream inject
 * carries the id.
 */
export function withCallId(callId: string, ctx: Context = context.active()): Context {
  const bag = (propagation.getBaggage(ctx) ?? propagation.createBaggage()).setEntry(CALL_ID_ATTR, {
    value: callId,
  });
  return propagation.setBaggage(ctx, bag);
}

/**
 * Run `fn` inside a new span that is a child of `parent` (or the active context).
 * The span is ended automatically; thrown errors mark it as errored and rethrow.
 * If the parent context carries a `call_id` baggage entry, it is stamped on the
 * span as an attribute so traces are filterable by call.
 */
export async function withSpan<T>(
  name: string,
  attributes: Record<string, string | number | boolean>,
  fn: (span: Span) => T | Promise<T>,
  parent?: Context,
): Promise<T> {
  const tracer = getTracer();
  const ctx = parent ?? context.active();
  const span = tracer.startSpan(name, { attributes }, ctx);
  const callId = callIdFromContext(ctx);
  if (callId) span.setAttribute(CALL_ID_ATTR, callId);
  const active = trace.setSpan(ctx, span);
  try {
    return await context.with(active, () => fn(span));
  } catch (error) {
    span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) });
    throw error;
  } finally {
    span.end();
  }
}

/** Read the call id from a context's baggage, if present. */
export function callIdFromContext(ctx: Context): string | undefined {
  return propagation.getBaggage(ctx)?.getEntry(CALL_ID_ATTR)?.value;
}

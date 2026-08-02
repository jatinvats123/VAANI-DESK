# ADR-0008: Runtime observability (metrics, tracing, error tracking)

Date: 2026-08-02 · Status: Accepted (metrics, dashboards, tracing, and error tracking landed)

## Context

The docs described measurement discipline (docs/latency-budget.md) but the runtime implemented
none of it: no `/metrics`, no traces, no error aggregation. Phase 0 (docs/GAP-AUDIT.md §5) flagged
this as the blocker for honestly filling the Phase 1/9 `TODO(measure-required)` numbers — you
cannot report p95 latency, cost per call, or a concurrency ceiling you never measured.

## Decision

### 1. One shared metric catalog: `packages/observability`

Prometheus metric names, help text, buckets, and label sets are defined **once** in a shared
package and instantiated per service via `createMetrics(service)`. Each service builds its **own
registry** (separate processes) and updates the subset it owns; unused instruments export zero.
Defining the full catalog everywhere means the committed Grafana dashboard queries the same
series regardless of which service emits them, and there is no name drift.

- **prom-client** (not OpenTelemetry metrics) for the metric layer: it is the de-facto standard,
  zero-config Node runtime metrics (`collectDefaultMetrics`), and Grafana/Prometheus scrape it
  directly. OTel metrics would add a collector dependency for no benefit at this scale.
- Naming follows Prometheus convention (`vd_*`, snake_case, base-unit suffix). A `service`
  default label lets one dashboard filter by api / voice-gateway / workers.

### 2. `/metrics` is guarded by the internal service secret

Metrics reveal call volumes and internal route names, so `/metrics` is **not public** — it
requires `Authorization: Bearer $INTERNAL_SERVICE_SECRET` (constant-time compared, reusing the
same secret the gateway already uses to reach the api). It is allow-listed from rate limiting
because a Prometheus scraper hits it every 15s.

### 3. Turn latency uses the six stages already defined in code

The histogram's `stage` label is exactly the six `TurnMetrics` fields the gateway already
stamps (`stt_endpoint`, `llm_ttft`, `llm_total`, `tool`, `tts_ttfb`, `turn_total`), with buckets
aligned to the p50 ≤ 1.2s / p95 ≤ 2.5s budget. So the runtime now measures the budget the docs
always claimed.

### 4. Alerts and runbook are committed, not just dashboards

`docs/observability/alerts.yml` (Prometheus rules) and `docs/RUNBOOK.md` ship together: every
alert has a runbook entry with diagnose/recover steps. Thresholds that depend on a real baseline
(booking conversion, and latency once load-tested) are marked `TODO(measure-required)` rather
than invented — per the honesty contract.

### 5. OpenTelemetry tracing: one call, one trace (landed)

Tracing is **feature-flagged on `OTEL_EXPORTER_OTLP_ENDPOINT`**. Unset (the default, and every
local/demo run) → `initTracing` is a clean no-op: the API's no-op tracer, no-op propagator, zero
spans, no headers added, no behavioural change to the call path. Set → the Node SDK starts with an
OTLP/HTTP exporter and W3C trace-context + baggage propagation. Propagation is **explicit, not
auto-instrumented**, because the services run under `tsx` where monkeypatch instrumentation + ESM
loading is fragile.

The call is the trace root, and its id is the propagation key:

- **Gateway** opens a `voice.call` root span per call (`startCallSpan`) and pins the `call_id` into
  baggage. It binds the internal api client to that context (`withTraceContext`), so every
  gateway → api request injects `traceparent` + `baggage`.
- **API** extracts the parent context on every request (`registerTracing` hook), opens a SERVER
  span as its child, and stashes a forward-carrier in an `AsyncLocalStorage` (`enterWith`) so a job
  enqueued mid-request carries the context onward. Verified by a Fastify integration test that the
  carrier survives an `await` inside the handler.
- **Workers** read that carrier from the job payload (a reserved `__trace` key the strict
  `jobPayloadSchema` strips on parse) and run each job inside a `worker.<type>` span parented to it.

Result: gateway → api → workers is a single trace keyed by `call_id`, end to end, with no change to
the demo path when tracing is off.

### 6. Error tracking: Sentry, PII-scrubbed, errors-only (landed)

Sentry runs in all four apps, **feature-flagged on `SENTRY_DSN`** (`NEXT_PUBLIC_SENTRY_DSN` for the
browser). Unset → a disabled client that sends nothing, so local/demo runs are untouched.

- **One scrubber, shared.** `scrubPII` (`@vaanidesk/shared`) is a pure `beforeSend`: it drops
  secret-bearing keys (`authorization`, `cookie`, `*secret`, `*token`, `*api-key`) and masks phone
  numbers in every string, reusing `normalizePhone` as the precise gate so ids/timestamps survive.
  This is the **same discipline as the pino redaction** — no caller PII or secret leaves the
  process. The three Node services use it via `@sentry/node`; web via `@sentry/nextjs`. Web imports
  it through the `@vaanidesk/shared/pii` subpath so the barrel's `node:crypto` (slug.ts) never
  reaches the edge/client bundle.
- **Errors only; OTel owns tracing.** Node init passes `skipOpenTelemetrySetup` and
  `tracesSampleRate: 0` so Sentry never registers its own OTel providers and fight decision #5.
- **Where we capture.** api: 5xx in the Fastify error handler (route template as tag, no raw
  path). gateway: session-setup failures. workers: only once a job's retries are exhausted (a
  transient failure that later succeeds isn't an alert). web: server/edge via the Next
  instrumentation hook + `onRequestError`, browser via `instrumentation-client`. Unhandled
  exceptions are captured by Sentry's default handlers. Every service flushes on shutdown.

These are additive and do not change the metric decisions above.

## Consequences

- Phases 1 and 9 can now measure cost-per-call, latency percentiles, and (after Phase 5 load
  testing) a concurrency ceiling from real scrapes instead of guesses.
- The metric layer is inert until scraped — no behavioural change to the call path, so the demo
  path is untouched. Every counter/gauge/histogram update is a cheap in-memory operation.
- New services must call `createMetrics` and expose the guarded `/metrics` endpoint to appear on
  the dashboard.

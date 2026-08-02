# ADR-0008: Runtime observability (metrics, tracing, error tracking)

Date: 2026-08-02 · Status: Accepted (metrics + dashboards landed; tracing + error tracking in progress)

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

### 5. Tracing and error tracking (in progress)

- **OpenTelemetry tracing** with a `call_id` propagated gateway → api → workers, so one phone
  call is one trace end to end.
- **Sentry** in all four apps, with PII scrubbing consistent with the existing pino redaction
  (`authorization`, `cookie`, phone numbers).

These are additive and do not change the metric decisions above.

## Consequences

- Phases 1 and 9 can now measure cost-per-call, latency percentiles, and (after Phase 5 load
  testing) a concurrency ceiling from real scrapes instead of guesses.
- The metric layer is inert until scraped — no behavioural change to the call path, so the demo
  path is untouched. Every counter/gauge/histogram update is a cheap in-memory operation.
- New services must call `createMetrics` and expose the guarded `/metrics` endpoint to appear on
  the dashboard.

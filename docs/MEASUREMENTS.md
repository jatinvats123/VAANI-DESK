# Measurements

The single source of truth for **real, measured** numbers vs. numbers we have **not** measured yet.
Per the honesty contract: nothing here is invented. A number appears only with its date, the exact
command/conditions that produced it, and the model/provider. Anything unmeasured is written as the
literal token `TODO(measure-required)` with the reason it isn't measured and how to get it.

Provider for all runs below: **Gemini free tier**, `gemini-flash-lite-latest`
(`LLM_PROVIDER=gemini`). See [ADR-0009](adr/0009-provider-agnostic-llm.md).

---

## Measured

### LLM integration (validated live, 2026-08-02)

Real calls to the Gemini API with the production system prompt, tool schema, and guardrails, via
the eval harness (`packages/evals`):

- **Auth + text generation + usage metadata**: working end to end.
- **Multi-turn tool calling** (`check_availability` → `create_booking`): working after fixing a real
  bug this run surfaced — thinking models attach a `thought_signature` to function-call parts that
  must be echoed back on later turns, or the follow-up request is rejected (`400`). The
  Anthropic↔Gemini bridge now preserves and round-trips it through message history.
- **Cost per call (LLM)**: **₹0** on the free tier (priced at 0 in `DEFAULT_MODEL_PRICING`). This is
  accurate for the free tier only; the paid tier / Vertex AI has real rates that must be filled in
  before billing (ADR-0009).

### Scenario result (validated live, 2026-08-02)

Single representative scenario, `hinglish-basic-booking`, `--no-db`
(`pnpm --filter @vaanidesk/evals run -- --filter hinglish-basic-booking --no-db`):

- verdict: **pass**
- judge score (0–1): **1.00** (LLM-as-judge, also on Gemini)
- LLM cost: **₹0.00** (free tier)
- wall-clock: **731s** — almost entirely free-tier per-minute rate-limit backoff, **not** model
  latency. This number says nothing about production turn latency; see the latency section below.
- LLM token counts: not surfaced by the harness's summary output (cost was ₹0, so nothing to price);
  add `--no-db` run token logging if a precise figure is needed.

> Note on sample size: one scenario proves the pipeline works end to end (Hinglish, multi-turn tool
> calls, booking, guardrails); it is **not** a pass-rate baseline. A real baseline needs the full
> 30-scenario suite — see below.

---

## Not yet measured — `TODO(measure-required)`

### Full-suite eval pass rate

`TODO(measure-required)`. Why: the free tier's per-minute rate limit makes a local 30-scenario run
impractically slow in one sitting. How to get it: run the **nightly** workflow (or CI) with a
`GEMINI_API_KEY` repo secret — the workflows are already provider-aware (Phase 3.5), take their own
time, and record the baseline the CI gate compares against. This also unblocks
[RUNBOOK.md](RUNBOOK.md)'s eval-baseline line.

### Voice-to-voice latency (the 6-stage turn budget)

`TODO(measure-required)` for every stage (`stt_endpoint`, `llm_ttft`, `llm_total`, `tool`,
`tts_ttfb`, `turn_total`) and the p50 ≤ 1.2s / p95 ≤ 2.5s budget in
[latency-budget.md](latency-budget.md). Why: measuring these needs the **full voice pipeline**
running a real call — Deepgram (STT), ElevenLabs (TTS), and a telephony number. None of those keys
are configured in this environment, so no real turn latency exists to report. How to get it: run
demo path **B** in [DEMO.md](DEMO.md); the gateway already records every stage into
`call_turns.metrics` and exposes `vd_turn_latency_seconds` on `/metrics` (Phase 3). The Grafana
panel "Turn latency p50/p95 by stage" will then show real numbers.

### Telephony + STT/TTS cost per call

`TODO(measure-required)`. Same reason: no Deepgram/ElevenLabs/Twilio credentials. The cost-accounting
plumbing exists (`computeLlmCostPaise`, `costBreakdown` on `calls`); only the per-provider rates and
real call minutes are missing.

### Booking conversion rate

`TODO(measure-required)`. Needs real call traffic to compute (voice bookings ÷ calls). This is why
the `BookingConversionDropped` alert threshold in
[observability/alerts.yml](observability/alerts.yml) is still a placeholder.

### Concurrency ceiling

`TODO(measure-required)`. Comes from the Phase 5 load test (k6 script exists in the repo), not yet run.

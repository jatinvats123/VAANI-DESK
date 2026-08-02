# Measurements

The single source of truth for **real, measured** numbers vs. numbers we have **not** measured yet.
Per the honesty contract: nothing here is invented. A number appears only with its date, the exact
command/conditions that produced it, and the model/provider. Anything unmeasured is written as the
literal token `TODO(measure-required)` with the reason it isn't measured and how to get it.

Provider for all runs below: **Gemini free tier**, `gemini-flash-lite-latest`
(`LLM_PROVIDER=gemini`). See [ADR-0009](adr/0009-provider-agnostic-llm.md).

---

## Measured

### Provider validation with real credentials (2026-08-02)

Every provider authenticated and was exercised with a real API call:

| Provider            | Auth | Real call exercised                                  | Notes                                                              |
| ------------------- | ---- | ---------------------------------------------------- | ----------------------------------------------------------------- |
| Gemini (LLM)        | ✓    | streaming turn + multi-turn tool calls               | free tier; `gemini-flash-lite-latest`                             |
| Deepgram (STT)      | ✓    | streamed μ-law → **verbatim transcript**             | `nova-3`, `language=multi`                                        |
| ElevenLabs (TTS)    | ✓    | stream-input WS → μ-law audio                        | free tier, 9,971/10,000 chars left. **Configured voice was paid** (`payment_required`); switched `ELEVENLABS_VOICE_ID` to a free voice. |
| Twilio (telephony)  | partial | account fetch + number list (200); caller-id + number-search (401) | Account `ACe7…` is **Trial** but owns **zero** numbers, and does **not** own the provided `+17372212163`. The 200/401 split across endpoints points to **Test Credentials or a different project**, not the live keys of the number's project. |

**Remaining blockers to a real inbound phone-call demo** (answer to "is the phone number the only
thing missing?"): **No.**
1. **Twilio credential ↔ number mismatch (current hard blocker).** The `TWILIO_ACCOUNT_SID` /
   `TWILIO_AUTH_TOKEN` in `.env` belong to an account that owns no numbers and does not own
   `+17372212163`. Fix: copy the **live** Account SID + Auth Token of the *same* Twilio project that
   lists `+17372212163` under Phone Numbers (Console → project switcher → Account Info). This is a
   config mismatch, **not** a trial restriction.
2. **Twilio Trial restrictions (apply once #1 is fixed).** Inbound calls to a trial number play a
   Twilio trial greeting before the app answers; only **verified** caller IDs can reach it (fine for
   your own verified phone; a third party can't demo it); the app's outbound *missed-call callback*
   works only to verified numbers. Media Streams (the audio path) do work on trial.
3. **ElevenLabs voice** (fixed): the originally-configured voice was paid (`payment_required`);
   switched `ELEVENLABS_VOICE_ID` to a free voice. Switch back on a paid plan.

Everything **up to the Twilio boundary** — Gemini, Deepgram, ElevenLabs — is validated working with
real credentials and real latency. What's left is the telephony transport: matching Twilio
credentials, then a public tunnel + running stack + you dialing, per demo path **B** in
[DEMO.md](DEMO.md).

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

### Per-stage latency, real providers (single samples, 2026-08-02)

Measured against the **real** provider APIs (not the live telephony round-trip). Single samples on
free tiers, so treat as ballpark, not p50/p95:

| Stage           | Provider / model                    | Measured                                           |
| --------------- | ----------------------------------- | -------------------------------------------------- |
| LLM TTFT        | Gemini `gemini-flash-lite-latest`   | **~1132ms** (total ~1157ms; correctly tool-called) |
| TTS TTFB        | ElevenLabs `eleven_flash_v2_5`, μ-law | **~553ms** warm (~1488ms cold first-connect)       |
| STT finalize    | Deepgram `nova-3`, multi, μ-law 8kHz | transcribed verbatim; **~730ms** after end-of-speech (synthetic feed) |

Reproduce: `apps/voice-gateway` → `pnpm exec tsx llm-latency.mts` and `... validate-voice.mts`
(the STT test synthesizes the caller line via ElevenLabs, then feeds that μ-law audio to Deepgram —
so it exercises both real providers).

> **Honest caveat that matters:** free-tier Gemini's LLM TTFT alone (~1.1s) nearly consumes the
> entire **1.2s voice-to-voice p50 budget** ([latency-budget.md](latency-budget.md)). The budget was
> written for a faster/paid model; on the free tier the demo will feel slower than the budget targets.
> This is a real finding, not a failure of the pipeline.

---

## Not yet measured — `TODO(measure-required)`

### Full-suite eval pass rate

`TODO(measure-required)`. Why: the free tier's per-minute rate limit makes a local 30-scenario run
impractically slow in one sitting. How to get it: run the **nightly** workflow (or CI) with a
`GEMINI_API_KEY` repo secret — the workflows are already provider-aware (Phase 3.5), take their own
time, and record the baseline the CI gate compares against. This also unblocks
[RUNBOOK.md](RUNBOOK.md)'s eval-baseline line.

### End-to-end voice-to-voice latency (the full 6-stage turn, live)

Component stages are now measured individually (LLM, TTS, STT — see the per-stage table above). What
is still `TODO(measure-required)` is the **live** voice-to-voice number: caller end-of-speech → first
audio byte, measured through the running gateway on a real call, i.e. the actual `turn_total` with
real network/telephony transport and barge-in. Why: that requires a real inbound call over Twilio
(see the blockers below), not just the providers in isolation. How to get it: run demo path **B** in
[DEMO.md](DEMO.md); the gateway records every stage into `call_turns.metrics` and exposes
`vd_turn_latency_seconds` on `/metrics` (Phase 3) — the Grafana "Turn latency p50/p95 by stage"
panel then shows real distributions.

### Telephony + STT/TTS cost per call

`TODO(measure-required)`. Provider **auth is validated** (Deepgram, ElevenLabs, Twilio all authenticate),
but per-call cost needs real call minutes over a real number. The cost-accounting plumbing exists
(`computeLlmCostPaise`, `costBreakdown` on `calls`); only the per-provider rates and real call
minutes are missing.

### Booking conversion rate

`TODO(measure-required)`. Needs real call traffic to compute (voice bookings ÷ calls). This is why
the `BookingConversionDropped` alert threshold in
[observability/alerts.yml](observability/alerts.yml) is still a placeholder.

### Concurrency ceiling

`TODO(measure-required)`. Comes from the Phase 5 load test (k6 script exists in the repo), not yet run.

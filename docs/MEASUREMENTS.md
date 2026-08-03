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
| Twilio (telephony)  | ✓ (creds valid) | Account/Calls/Messages/IncomingPhoneNumbers → 200; OutgoingCallerIds/AvailablePhoneNumbers → 401 `20003 Policy evaluation failed` | Valid **Live** keys for `ACe7…` (SID `AC`+32hex, token 32hex; Account 200 proves auth). Account is a **fresh restricted Trial**: number-provisioning + caller-ID endpoints are policy-blocked. Owns **zero** REST `IncomingPhoneNumbers`. |

**Root cause of "REST shows 0 numbers but the Console shows `+17372212163`":** not a credential
mismatch and not wrong keys (both disproven — the keys authenticate). The account is a brand-new,
**unverified/restricted Trial**, so Twilio returns `20003 Policy evaluation failed` on
number-management endpoints, and the trial number is provisioned through Twilio's **new-trial
"Inbound Try it out" flow — which is not a standard `IncomingPhoneNumber` REST resource**. That is
why the REST list is empty while the Console shows the number. It's Twilio's new trial architecture +
a restricted-trial policy.

**Does this block the inbound demo? No.** VaaniDesk resolves an inbound call by looking up the dialed
number in **its own DB** (`businesses.getByPhoneNumber(body.To)` in `webhooks/telephony.ts`); it
**never** calls Twilio's REST API to resolve the number. So a real inbound call to `+17372212163`
works once:
1. Twilio's "Inbound Try Out" **Voice webhook** for that number points at the app's **public**
   `POST /webhooks/telephony/twilio/voice` (an ngrok URL to the api).
2. The app's DB has a **business whose phone number == `+17372212163`** — else the webhook is
   skipped ("No business owns …"). Seed/onboard that number.
3. The app + gateway run and are publicly reachable (webhook to api, `wss://` Media Stream to the
   gateway); `PUBLIC_API_URL` matches the tunnel so Twilio's signature verifies (or set
   `WEBHOOK_SIGNATURE_MODE=log` in dev).

**What the Trial genuinely blocks (error 20003 / standard trial):**
- The app's **missed-call callback** and any **outbound/number-management REST** calls — policy-
  blocked until the trial is verified/upgraded.
- Inbound plays a **trial greeting** before the app answers; only **verified caller IDs** can reach
  the number. Media Streams (the audio path) work on trial.

**ElevenLabs voice** (fixed): the originally-configured voice was paid (`payment_required`); switched
`ELEVENLABS_VOICE_ID` to a free voice. Switch back on a paid plan.

Everything **up to the Twilio boundary** — Gemini, Deepgram, ElevenLabs — is validated with real
credentials and latency. The inbound call itself needs: the number mapped to a business in the app
DB, the app running behind a public tunnel with the Try-Out webhook pointed at it, and **you dialing
from your verified phone** (per demo path **B** in [DEMO.md](DEMO.md)).

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

### Full-pipeline turn latency, real gateway (2026-08-03) — Path B

The **entire gateway pipeline** exercised end to end over Twilio's Media Streams protocol **without
Twilio** (a client speaks the wire protocol to `/stream`): a synthesized μ-law caller line → real
Deepgram STT → real Gemini (which correctly called `check_availability`) → real ElevenLabs TTS, on a
real DB call record, read from the gateway's own `vd_turn_latency_seconds`. **3 turns.** Only Twilio's
PSTN transport is absent (blocked — see below).

| Stage (gateway metric) | Meaning                              | Measured (3 turns) |
| ---------------------- | ------------------------------------ | ------------------ |
| `llm_ttft`             | Gemini time-to-first-token           | **~1.0–1.4 s** ← dominant |
| `tts_ttfb`             | ElevenLabs time-to-first-audio-byte  | **~0.22–0.27 s**   |
| `tool`                 | `check_availability` → api round-trip | **~0.04–0.07 s**   |
| `turn_total`           | utterance-end → first agent audio    | **~1.3–1.5 s**     |
| `llm_total`            | full LLM incl. tool round            | **~1.9–2.2 s**     |
| voice-to-voice (client-observed) | caller stops → first agent audio, incl. ~1 s endpointing | **2768 / 3277 / 3193 ms** |

Reproduce: `apps/voice-gateway` → `pnpm exec tsx simulate-call.mts` (needs the api + gateway running
and the number onboarded via `packages/db` → `onboard-demo-number.mts`).

> **`turn_total` ~1.3–1.5 s slightly exceeds the p50 ≤ 1.2 s budget**, almost entirely because of
> free-tier Gemini's ~1 s TTFT — everything else (STT, TTS ~0.25 s, tool ~0.05 s) is well within
> budget. A faster/paid LLM would bring it under. This is the real, honest read of the pipeline.

---

## Not yet measured — `TODO(measure-required)`

### Full-suite eval pass rate

`TODO(measure-required)`. Why: the free tier's per-minute rate limit makes a local 30-scenario run
impractically slow in one sitting. How to get it: run the **nightly** workflow (or CI) with a
`GEMINI_API_KEY` repo secret — the workflows are already provider-aware (Phase 3.5), take their own
time, and record the baseline the CI gate compares against. This also unblocks
[RUNBOOK.md](RUNBOOK.md)'s eval-baseline line.

### Live (over-PSTN) voice-to-voice latency

The full pipeline turn latency **is now measured** through the real gateway (see the Path B table
above). What remains `TODO(measure-required)` is only the **live-over-Twilio** number — the same turn
plus real PSTN/telephony transport and codec — which adds network delay on top of the measured
`turn_total`. Why still open: bidirectional Twilio **Media Streams (`<Connect><Stream>`) does not
execute on this fresh restricted trial** — the webhook + TwiML are proven working (the caller heard a
`<Say>` test), but Twilio never opens the audio WebSocket (0 `/stream` attempts) and every Twilio
error endpoint is 401 (the same `20003` policy). How to get it: verify/upgrade the Twilio account to
unlock bidirectional Media Streams, then dial — the stack is already wired (DEMO.md path B) and
records `vd_turn_latency_seconds` on `/metrics`.

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

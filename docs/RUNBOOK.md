# VaaniDesk Operations Runbook

One entry per alert in `docs/observability/alerts.yml` (anchors match the `alertname`). Each
entry: **what it means · who it affects · how to diagnose · how to recover**. The most
customer-damaging failure in this product is **silence on a live call** — treat anything that
causes it as page-worthy.

Scrape endpoints (all guarded by the internal service secret — send
`Authorization: Bearer $INTERNAL_SERVICE_SECRET`):

| Service | Metrics URL |
|---|---|
| api | `http://api:4000/metrics` |
| voice-gateway | `http://voice-gateway:4100/metrics` |
| workers | `http://workers:9095/metrics` |

---

## TurnLatencyP95OverBudget

**Means:** p95 voice-to-voice turn latency is over the 2.5s budget (docs/latency-budget.md).
**Affects:** every live caller — they hear dead air and may hang up.
**Diagnose:**
1. Open the Grafana "Turn latency by stage" panel. Which stage dominates —
   `llm_ttft`, `tts_ttfb`, or `stt_endpoint`?
2. `llm_ttft` high → check `ProviderErrorSpike` for the LLM; a free-tier Gemini 429 storm
   injects retry latency (see docs/GAP-AUDIT.md §9). Confirm you are not over the RPM limit.
3. `tts_ttfb` high → ElevenLabs latency or concurrency throttling.
4. `stt_endpoint` high → Deepgram endpointing config or network.
**Recover:** if one provider is degraded, expect Phase 5 circuit-breakers/fallback to cover it;
until then, reduce concurrency (fewer simultaneous calls) or switch the affected provider's key
to a healthier tier. This alert does not by itself drop calls — it degrades UX.

## ProviderErrorSpike

**Means:** a provider (Deepgram/ElevenLabs/LLM) is returning errors above threshold.
**Affects:** live calls. **TTS errors = silence on the call — the worst outcome.**
**Diagnose:**
1. `vd_provider_requests_total{result="error"}` by `provider`/`kind` — which one?
2. Check the provider status page and your account (credit/quota). Free-tier ElevenLabs caps
   concurrency at ~2; free-tier Gemini at ~15 RPM (GAP-AUDIT §9).
3. Gateway logs: `stt stream error` / `tts error mid-turn` / `llm turn failed`.
**Recover:** rotate to a funded key/tier; lower concurrency; if the LLM, confirm
`AGENT_MODEL`/provider env is correct. Post-Phase-5 a secondary TTS/STT provider auto-covers
this.

## QueueBackingUp

**Means:** >100 notification jobs waiting for 10m.
**Affects:** customers waiting on WhatsApp confirmations/reminders (not the live call).
**Diagnose:**
1. `vd_queue_depth{state}` — is `active` ~0 while `waiting` climbs? Workers are stalled or down.
2. `docker compose ps` / orchestrator: are worker replicas healthy?
3. Redis reachable from workers? WhatsApp provider erroring (jobs retrying)?
**Recover:** restart/scale worker replicas; if WhatsApp is the cause, jobs retry with backoff and
drain once it recovers — no data is lost (the booking already succeeded).

## JobFailureRateHigh

**Means:** >25% of job attempts failing over 15m.
**Affects:** confirmations/reminders/recordings.
**Diagnose:** worker logs for the failing `job_type`; a permanent 4xx (bad WhatsApp template,
unregistered test recipient) is audited as a skip, so sustained *failures* point at a systemic
issue (bad token, Redis, S3). Check `webhook_events` / `audit_log` for the reason.
**Recover:** fix the credential/config; BullMQ retries drain the backlog.

## WebhookSignatureFailures

**Means:** sustained signature/token verification failures from a provider.
**Affects:** inbound calls (telephony) or delivery receipts (WhatsApp) silently dropped.
**Diagnose — most common cause first:**
1. **`PUBLIC_API_URL` mismatch** — Twilio signs over the exact URL; a wrong origin rejects every
   webhook (GAP-AUDIT / docs/deployment.md). Verify it equals the public HTTPS origin.
2. Rotated provider secret not updated in env.
3. Genuine spoofing attempt (rare) — the ledger + signature check are doing their job.
**Recover:** correct `PUBLIC_API_URL` / the provider secret and redeploy. Never set
`WEBHOOK_SIGNATURE_MODE=log` in production to "fix" this — that disables the check.

## BookingConversionDropped

**Means:** voice bookings per completed call fell below baseline for 2h.
**Affects:** revenue and the customer's ROI story.
**Diagnose:**
1. Did a prompt/model/config change ship? Correlate with deploy time.
2. Run the eval suite (`pnpm --filter @vaanidesk/evals run`) — has the pass rate regressed?
   (Baseline is `TODO(measure-required)` until the suite runs against a real model.)
3. Check `vd_guardrail_triggers_total` — a spike in `unauthorized_amount` or `budget_transfer`
   suggests the agent is derailing.
**Recover:** roll back the offending change; the eval CI gate should have caught it — verify the
gate actually ran (it skips without the LLM key; GAP-AUDIT §4).

## ServiceDown

**Means:** Prometheus can't scrape a service for 2m. **Critical** if it's the gateway or api.
**Affects:** gateway down = no calls answered; api down = no bookings/dashboard.
**Diagnose:** health endpoints (`/healthz`, api `/readyz` checks Postgres+Redis); orchestrator
events; recent deploy. **The gateway is stateful** — a crash drops in-flight calls; Twilio's
status webhook reconciles the call rows so the dashboard shows no zombies.
**Recover:** restart the service. For the gateway, prefer a **drained** restart (SIGTERM waits
up to `DRAIN_TIMEOUT_MS`) so active calls finish; a hard kill drops live callers.

---

## General notes

- **Metrics are not public.** Every `/metrics` requires the service-secret bearer. Do not expose
  them on the public internet.
- **Redaction:** logs redact `authorization`/`cookie` (pino config). Keep that parity when
  adding Sentry (Phase 3 remaining work).
- **Cardinality:** HTTP metrics use the route *template*, not the raw path — keep it that way or
  label cardinality explodes.

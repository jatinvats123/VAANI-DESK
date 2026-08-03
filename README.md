# VaaniDesk

**AI voice receptionist for Indian service SMBs.** Answers your business line in
Hindi/Hinglish/English, checks real availability, books appointments, sends WhatsApp
confirmations, and gives owners a live dashboard. _Never miss a booking again._

> वाणी (vaani) — "voice". Built for salons, clinics, and rental businesses where every missed
> call is missed revenue.

**Stack:** TypeScript (strict) · Node 22 · pnpm + Turborepo monorepo · Fastify · Next.js 15 ·
Postgres + Drizzle · Redis + BullMQ · WebSocket media streaming · Deepgram (STT) · ElevenLabs (TTS) ·
Gemini / Anthropic (LLM, provider-agnostic) · Twilio / Exotel · Prometheus + OpenTelemetry + Sentry ·
GitHub Actions CI. ~17k LOC, 8 packages, 190+ tests.

## How it works

```
Caller ──► Twilio/Exotel ──► voice-gateway (WS, per-call state machine)
                                │  streaming STT ─ LLM (tool calling) ─ streaming TTS
                                ▼
                              api (Fastify) ──► Postgres (bookings, calls, tenants)
                                │                    ▲
                                ▼                    │
                    Redis (pub/sub + BullMQ) ──► workers ──► WhatsApp confirmations
                                │
                                ▼
                              web (Next.js dashboard, live transcripts)
```

The agent operates under hard guardrails: **prices and slots come only from the database, and a
booking is only ever spoken as confirmed after the `create_booking` tool succeeds.** Full detail
in [docs/architecture.md](docs/architecture.md), decision records in [docs/adr/](docs/adr/).

## Workspace map

| Path                 | What it is                                                           |
| -------------------- | -------------------------------------------------------------------- |
| `apps/web`           | Next.js 15 dashboard: live calls, bookings, transcripts, onboarding  |
| `apps/api`           | Fastify REST `/v1`, webhooks, agent tools, live-call WS              |
| `apps/voice-gateway` | Stateful WS media server: STT→LLM→TTS pipeline, barge-in, guardrails |
| `apps/workers`       | BullMQ consumers: WhatsApp confirmations, 24h/2h reminders           |
| `packages/shared`    | Result type, error taxonomy, env parsing, time/tz, phone, pagination |
| `packages/core`      | Pure domain logic: availability engine, booking state machine        |
| `packages/db`        | Drizzle schema, migrations, tenant-scoped data-access layer          |
| `packages/agent`     | Prompt assembly, tool schemas, guardrails, cost accounting           |
| `packages/evals`     | Scenario eval harness: scripted callers, judge, CI pass-rate gate    |

## Getting started

Prereqs: Node ≥ 22, pnpm ≥ 10 (`npm i -g pnpm@10`), Docker.

```bash
pnpm install
cp .env.example .env          # fill in provider keys as needed
docker compose up -d          # local Postgres + Redis
pnpm db:migrate               # apply schema
pnpm db:seed                  # demo salon with bookings + a call transcript
pnpm dev                      # run all services
```

Quality gates (run what CI runs):

```bash
pnpm lint && pnpm typecheck && pnpm test
```

## Demo & measurements

- **[docs/DEMO.md](docs/DEMO.md)** — see it work: a keyless text demo on Gemini's free tier, and the
  full live-phone-call runbook (needs STT/TTS/telephony keys).
- **[docs/MEASUREMENTS.md](docs/MEASUREMENTS.md)** — the honest ledger of what's really been measured
  vs. what's still `TODO(measure-required)` (and why). No invented numbers.

### Validated end-to-end (real measurements)

The full voice pipeline was exercised against **real** providers (Deepgram STT, Gemini LLM,
ElevenLabs TTS) over Twilio's Media Streams protocol on a real call record:

- **`turn_total` ~1.3–1.5 s** (caller utterance-end → first agent audio) — within striking distance
  of the p50 ≤ 1.2 s budget; the gap is entirely free-tier LLM time-to-first-token (~1.0–1.4 s),
  while STT, TTS (~0.25 s) and the DB-backed tool call (~0.05 s) are well inside budget.
- A real eval scenario (Hinglish booking, multi-turn tool calls) **passed** with an LLM-judge score
  of **1.00**. Numbers, dates, and repro commands are in the ledger.

## Status & known limitations

Production-grade engineering, demo-ready pipeline. The **one** outstanding item is the live
over-PSTN phone call: bidirectional Twilio Media Streams (`<Connect><Stream>`) is blocked on the
current **restricted trial** account (Twilio error `20003`), which is why the through-the-gateway
latency above was captured via a Media Streams simulator rather than a live call. The webhook, TwiML,
number→tenant mapping, and full audio pipeline are all verified working; unblocking it is a Twilio
account upgrade, not a code change. See [docs/MEASUREMENTS.md](docs/MEASUREMENTS.md) for the full
diagnosis.

## Engineering principles

- **Trust over cleverness** — the agent never invents prices, slots, or confirmations; every
  spoken fact traces to a tool result recorded on the call turn.
- **Tenant isolation by construction** — every query goes through a DAL pre-scoped to one
  `business_id` ([ADR-0003](docs/adr/0003-database-and-tenancy.md)).
- **Pure core** — the availability engine has no I/O and exhaustive unit tests.
- **Latency is a budget, not a hope** — every pipeline stage is measured per turn against
  [docs/latency-budget.md](docs/latency-budget.md).
- **Evals are tests** — 30 scripted caller scenarios gate CI like a test suite.

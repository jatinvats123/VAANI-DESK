# VaaniDesk — System Architecture

VaaniDesk is an AI voice receptionist for Indian service SMBs. A business forwards (or provisions)
a phone number; VaaniDesk answers in Hindi/Hinglish/English, checks real availability, books
appointments, sends WhatsApp confirmations, and streams everything to a live owner dashboard.

## 1. Topology

Two runtime services plus workers, deliberately split by state profile:

```mermaid
flowchart LR
    Caller((Caller<br/>PSTN)) -->|voice| Twilio[Twilio / Exotel]
    Twilio -->|"media WS (μ-law 8kHz)"| GW

    subgraph Stateful
        GW["voice-gateway<br/>Node WS server<br/>per-call state machine"]
    end

    GW <-->|streaming| STT["STT<br/>Deepgram / Sarvam"]
    GW <-->|streaming| LLM["LLM<br/>Claude (tool calling)"]
    GW <-->|streaming| TTS["TTS<br/>ElevenLabs / Sarvam"]

    subgraph Stateless
        API["api<br/>Fastify REST /v1<br/>webhooks"]
        WEB["web<br/>Next.js dashboard"]
    end

    GW -->|"tool calls (HTTP, service token)"| API
    WEB -->|REST + WS| API
    Owner((Owner<br/>mobile/desktop)) --> WEB

    API --> PG[(Postgres<br/>Neon)]
    API --> RD[(Redis<br/>Upstash)]
    GW -->|"live events pub/sub"| RD
    RD -->|/ws/live-calls| API

    WORK["workers<br/>BullMQ consumers"] --> RD
    WORK --> PG
    WORK -->|confirmations + reminders| WA[WhatsApp Cloud API]
```

### Why two services (summary — full rationale in ADR-0002)

- **voice-gateway is stateful**: it holds a persistent media WebSocket per call, an in-memory
  per-call state machine (audio buffers, partial transcripts, turn budget, barge-in state), and
  must make sub-100ms scheduling decisions. It cannot be serverless and must not be redeployed
  casually mid-call.
- **api + web are stateless**: standard request/response, horizontally scalable, safe to deploy
  continuously. All durable writes go through the api's data-access layer, so tenant isolation
  and guardrails ("prices/slots only from DB") live in exactly one place.
- **Redis bridges them**: the gateway publishes `call.*` events (started, partial transcript,
  turn completed, ended) to Redis pub/sub; the api fans them out to dashboard WebSocket clients.
  BullMQ (same Redis) carries deferred work: WhatsApp sends, reminders, webhook processing.

## 2. One full call — sequence diagram

The contract this diagram encodes: **a booking is only ever spoken as confirmed after
`create_booking` returns success from Postgres.** The agent never invents prices, slots, or
confirmations; every number it speaks came out of a tool result.

```mermaid
sequenceDiagram
    autonumber
    participant C as Caller
    participant T as Twilio
    participant GW as voice-gateway
    participant STT as STT (Deepgram)
    participant LLM as LLM (Claude)
    participant TTS as TTS
    participant API as api (Fastify)
    participant DB as Postgres
    participant R as Redis
    participant W as Dashboard (owner)
    participant WA as WhatsApp

    C->>T: dials business number
    T->>API: POST /webhooks/telephony (call.initiated, signed)
    API->>DB: verify signature, dedupe via webhook_events,<br/>lookup business by to_number, insert calls row
    API-->>T: TwiML: <Connect><Stream> to gateway WS
    T->>GW: WS connect (media stream, callSid + businessId)
    GW->>API: GET /v1/internal/call-context/:callSid (service token)
    API->>DB: load business profile, services, hours, prompt_config
    API-->>GW: CallContext (assembled system prompt, tool defs, policy)
    GW->>R: PUBLISH call.started
    R-->>W: live call appears on dashboard

    GW->>TTS: synthesize greeting + consent notice ("यह कॉल रिकॉर्ड हो सकती है…")
    TTS-->>GW: audio stream
    GW->>T: audio → caller hears greeting

    loop Each conversation turn (budgeted, max N turns)
        C->>T: speech ("कल शाम हेयरकट मिलेगा?")
        T->>GW: μ-law audio frames
        GW->>STT: stream audio
        STT-->>GW: partial transcripts (word-level)
        GW->>R: PUBLISH call.transcript.partial
        R-->>W: streaming transcript on dashboard
        STT-->>GW: endpoint detected → final transcript
        GW->>LLM: messages + tool schemas (streaming)
        LLM-->>GW: tool_use: check_availability(service, date)
        GW->>API: POST /v1/internal/tools/check_availability
        API->>DB: availability engine over real bookings
        API-->>GW: open slots (from DB only)
        GW->>LLM: tool_result → continue
        LLM-->>GW: streamed text ("कल शाम 5 बजे free है…")
        GW->>TTS: stream text (sentence-chunked)
        TTS-->>GW: first audio byte (<300ms target)
        GW->>T: audio → caller (barge-in cancels playback)
        GW->>API: POST /v1/internal/turns (transcript, tools, latency metrics)
    end

    C->>T: "हाँ, book कर दो"
    LLM-->>GW: tool_use: create_booking(...)
    GW->>API: POST /v1/internal/tools/create_booking (idempotency_key = callSid:turn)
    API->>DB: INSERT booking (unique idempotency_key, availability re-check)
    API-->>GW: booking confirmed {id, time, service, price}
    API->>R: enqueue whatsapp.confirmation job
    GW->>LLM: tool_result: success
    LLM-->>GW: confirmation utterance (only now)
    GW->>TTS: speak confirmation
    R->>WA: worker sends WhatsApp confirmation template
    WA-->>C: booking confirmation message

    C->>T: hangs up
    T->>API: POST /webhooks/telephony (call.completed)
    GW->>API: POST /v1/internal/calls/:id/complete (outcome, cost, latency rollup)
    GW->>R: PUBLISH call.ended
    R-->>W: dashboard updates (outcome, recording link)
```

Failure paths (each has an explicit state-machine transition in the gateway):

- **STT/LLM/TTS provider error or timeout** → one retry where safe → apologize + offer owner
  transfer (`<Dial>` to owner_phone) → outcome `transferred`.
- **Turn budget exceeded / caller asks for human / abuse detected** → immediate transfer path.
- **Tool failure (e.g. slot taken between check and create)** → LLM receives structured error and
  re-negotiates ("वो slot अभी book हो गया, 5:30 चलेगा?") — never a fake confirmation.
- **Gateway crash mid-call** → Twilio status callback fires `call.completed`; api reconciles the
  orphaned `calls` row via the webhook path (outcome `failed`), so the dashboard never shows a
  zombie live call.

## 3. Monorepo layout

```
vaanidesk/
├── apps/
│   ├── web/              # Next.js 15 App Router — dashboard + onboarding (stateless)
│   ├── api/              # Fastify REST /v1 + webhooks + /ws/live-calls (stateless)
│   ├── voice-gateway/    # Node WS media server — per-call state machine (stateful)
│   └── workers/          # BullMQ consumers: WhatsApp sends, reminders, reconciliation
├── packages/
│   ├── shared/           # Result type, error taxonomy, env parsing, time/tz, phone, pagination
│   ├── core/             # Pure domain logic: availability engine, booking rules (no I/O)
│   ├── db/               # Drizzle schema + migrations + tenant-scoped data-access layer
│   ├── agent/            # Prompt assembly, tool JSON schemas, guardrails, cost accounting
│   └── evals/            # 30-scenario eval harness: scripted callers, judge, CI gate
├── docs/
│   ├── adr/              # Architecture decision records
│   ├── architecture.md   # This file
│   └── latency-budget.md # Per-stage latency targets and measurement points
├── docker-compose.yml    # Local Postgres + Redis
└── turbo.json / pnpm-workspace.yaml
```

Dependency rule (enforced by review + lint):
`shared ← core ← db ← agent ← {api, voice-gateway, workers, web}` — arrows point at dependents.
`core` is pure (no I/O, no Drizzle imports) so the availability engine is trivially unit-testable.
Apps never import each other; they talk over HTTP/Redis.

## 4. Multi-tenancy

Every tenant-owned table carries `business_id`. Isolation is enforced in the data-access layer
(`packages/db/src/dal`): repositories are constructed _for_ a business
(`dal.forBusiness(businessId)`) and it is impossible to express a cross-tenant query through
them. Routes never hand-write `where business_id = ?`. Details in ADR-0003.

## 5. Deployment

| Component     | Platform                   | Notes                                                                            |
| ------------- | -------------------------- | -------------------------------------------------------------------------------- |
| web           | Vercel                     | RSC, edge-cached static, preview deploys per PR                                  |
| api           | Railway/Fly                | stateless, N replicas behind LB                                                  |
| voice-gateway | Railway/Fly                | fewer, larger instances; sticky by call (one WS = one call); drain before deploy |
| workers       | Railway/Fly                | BullMQ concurrency-tuned                                                         |
| Postgres      | Neon                       | branches for preview envs                                                        |
| Redis         | Upstash                    | pub/sub + BullMQ                                                                 |
| Recordings    | S3-compatible (ap-south-1) | private bucket, signed URLs only                                                 |

Environments: `dev` (docker-compose) → `preview` (per-PR, Neon branch) → `prod`. Separate keys
per environment; secrets only via platform env vars.

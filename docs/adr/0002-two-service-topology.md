# ADR-0002: Stateful voice-gateway split from stateless api/web

Date: 2026-07-17 · Status: Accepted

## Context

A live phone call is a long-lived, latency-critical, stateful session: a persistent media
WebSocket from the telephony provider, in-flight audio buffers, streaming STT partials, an LLM
turn in progress, TTS audio being chunked back — all coordinated by a per-call state machine
with a p50 response target under 1.2s. The dashboard/API workload is the opposite: short,
stateless, cache-friendly HTTP requests.

## Decision

Two runtime services with different lifecycles:

1. **`voice-gateway`** (stateful): owns telephony media WebSockets, the per-call state machine
   (greeting → listening → thinking → speaking → transferring → done), barge-in handling, turn
   budgets, and provider streaming clients. Holds call state in memory for the duration of the
   call. Deployed on instances that drain active calls before shutdown.
2. **`api`** (stateless): REST `/v1`, telephony/WhatsApp webhooks, dashboard WebSocket
   (`/ws/live-calls`), and — critically — the **only** writer to Postgres. The gateway performs
   all durable actions (check availability, create booking, log turns) by calling internal api
   endpoints authenticated with a short-lived service token.

**Redis pub/sub** bridges them: gateway publishes `call.*` events; api subscribes and fans out
to dashboard WS clients. **BullMQ** on the same Redis carries deferred jobs (WhatsApp sends,
reminders), consumed by `workers`.

## Why not alternatives

- _Single monolith_: a dashboard deploy would drop live calls; GC pauses from bulk API work
  would blow the latency budget; scaling knobs (many small HTTP replicas vs few large media
  instances) conflict.
- _Gateway writes to Postgres directly_: duplicates the tenant-isolation DAL and guardrail
  enforcement in two services; a compromised or buggy gateway could bypass booking invariants.
  Funneling writes through the api keeps "bookings only exist if the DB says so" enforceable in
  one place. Trade-off: one extra intra-datacenter HTTP hop (~5–15ms) per tool call — well
  inside budget.
- _Serverless gateway_: WebSocket lifetime and cold starts are disqualifying.

## Consequences

- Gateway crash loses only in-memory call state; the telephony status webhook lets the api
  reconcile the call row, so no zombie live calls.
- Future horizontal gateway scaling = sticky sessions per call + (documented, not built) moving
  resumable call state to Redis.
- Clear security boundary: only the api holds DB credentials and WhatsApp tokens; the gateway
  holds only provider streaming keys + a service token.

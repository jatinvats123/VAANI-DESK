# ADR-0006: Async jobs, reminders, and WhatsApp delivery

Date: 2026-07-18 · Status: Accepted

## Context

Booking confirmations and 24h/2h reminders must survive api restarts, tolerate WhatsApp/Meta
outages, and never block or fail a booking write. Cancelled bookings must not receive reminders.

## Decisions

### 1. One BullMQ queue, typed payloads, contracts in `shared`

A single `vd-notifications` queue carries a zod-validated payload union
(`booking_confirmation | booking_reminder | booking_cancellation`). Queue name, payload schemas,
deterministic job-id helpers, and reminder-delay math live in `@vaanidesk/shared` with no BullMQ
dependency — producer (api) and consumer (workers) can't drift, and a version skew degrades to a
visibly dropped job, not a crashed worker.

### 2. Enqueueing is best-effort beside the source of truth

The api's `JobEnqueuer` port contract: **implementations never throw**. The booking row is the
record; a Redis blip loses at worst a notification (visible in logs + missing audit entry),
never a booking. Reminders are BullMQ delayed jobs computed at creation
(`computeReminderDelays` skips windows already passed); cancellation removes queued reminder
jobs by deterministic id _and_ the handler re-checks booking status at fire time — belt and
braces, because a reminder could already be running when the cancel lands.

### 3. Workers read through the DAL; bookings are still written only via the api

Workers consume `packages/db` directly for reads and notification bookkeeping (audit entries,
webhook ledger updates). The ADR-0002 rule narrows to what it always protected: **booking and
call domain writes flow through the api's service layer**. Notification bookkeeping is not
domain state, and forcing an HTTP hop for every reminder read adds failure modes without adding
protection — the DAL's tenant scoping applies identically here.

### 4. WhatsApp Cloud API, pre-approved templates, honest failure taxonomy

Business-initiated messages must be templates; template _texts_ live in the WhatsApp manager,
the repo owns only the positional parameter contract (documented in
`workers/src/whatsapp/messages.ts`). Send failures split: 429/5xx/network → throw → BullMQ
exponential backoff (5 attempts); 4xx (bad template, invalid number) → audited `skipped`, no
retry. Missing credentials behave like a permanent failure — audited, never mocked.

### 5. Inbound WhatsApp webhooks join the existing ledger discipline

`GET /webhooks/whatsapp` answers Meta's subscription handshake; `POST` verifies
`X-Hub-Signature-256` over the **raw body** (route-scoped raw-body capture), then dedupes into
`webhook_events` exactly like telephony. MVP consumes delivery statuses for observability;
reply-driven flows (reply 1 to cancel) build on the same ledger later.

## Consequences

- Notification delivery is at-least-once with dedupe at enqueue (job ids) and a status re-check
  at send — a customer can receive a duplicate only if a send succeeds and the audit write then
  fails inside a retried job, which we accept for MVP.
- The queue is horizontal-scale ready: workers are stateless, concurrency is env-tuned, and a
  future `queue-rate-limited sends` requirement is a BullMQ limiter option away.

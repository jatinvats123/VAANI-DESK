# ADR-0004: API authentication surfaces and validation strategy

Date: 2026-07-17 · Status: Accepted

## Context

The api serves three very different callers: dashboard users (browsers, cookies), the voice
gateway (trusted service, latency-critical), and telephony/WhatsApp providers (webhooks, no
shared session). Each needs a distinct trust mechanism, and all responses must share one typed
error contract.

## Decisions

### 1. Dashboard: Auth.js database sessions shared at the DB layer

Auth.js (in `apps/web`) writes database sessions; the api validates the same httpOnly session
cookie by joining `sessions → users` directly. No JWTs, no token exchange, instant revocation,
and the api never handles credentials. Trade-off: one indexed DB read per request — acceptable,
and cacheable later without changing the contract.

### 2. Tenancy: membership guard constructs the scoped DAL

`requireMembership(minRole)` resolves `(userId, businessId) → role`, rejects non-members with
the same 403 as nonexistent businesses (no tenant enumeration), and attaches
`dal.forBusiness(businessId)` to the request. Handlers physically cannot query another tenant.
Owner-only operations (settings, services, prices) take `minRole: "owner"`.

### 3. Gateway: constant-time shared-secret bearer on `/v1/internal/*`

The gateway authenticates with `INTERNAL_SERVICE_SECRET` compared via `timingSafeEqual`. Chosen
over signed per-request tokens because both services live in the same private network and the
secret grants exactly what the gateway needs anyway; rotation is a config change. Revisit
(short-lived signed tokens) if the gateway ever runs outside the trust boundary.

### 4. Webhooks: provider signatures + ledger, never sessions

Twilio requests are verified with the documented HMAC-SHA1 scheme over `PUBLIC_API_URL` + sorted
params (unit-tested against Twilio's published example vector). `WEBHOOK_SIGNATURE_MODE=log`
exists for local tunnels only — production enforces. Verified events enter `webhook_events`
(unique per provider+event) before any processing; replays short-circuit.

### 5. Validation and errors: zod at the edge, one envelope out

`fastify-type-provider-zod` compiles zod schemas for params/query/body, so route handlers see
fully-typed, already-validated input. Every failure — AppError, zod validation, Fastify
internals — funnels through one error handler into the `{ error: { code, message, details?,
requestId } }` envelope. `slot_unavailable` errors carry nearby alternative slots in `details`,
which is what lets the voice agent re-negotiate a taken slot in one turn.

### 6. Concurrency: per-tenant advisory lock, not serializable isolation

Booking writes take `pg_advisory_xact_lock(hashtext(business_id))` inside the transaction before
the capacity re-check. Serializes writers per business (a salon books a few times an hour — no
throughput concern) while different tenants never contend. Chosen over SERIALIZABLE because
retry loops in a voice flow add latency and complexity where a lock adds none.

## Consequences

- The booking invariant ("confirmed ⇒ row existed after an in-transaction re-check") holds under
  concurrency, retries (idempotency key), and webhook replays (event ledger) simultaneously.
- Rate limiting exempts signature-verified and service-token surfaces so an attacker cannot
  starve real telephony traffic by exhausting the IP bucket.

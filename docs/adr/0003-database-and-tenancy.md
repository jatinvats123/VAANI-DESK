# ADR-0003: Database schema, money, and tenant isolation

Date: 2026-07-17 · Status: Accepted

## Context

Multi-tenant SaaS where a tenant leak is an existential trust failure, and where the voice agent
must only ever speak prices/slots that exist in the database.

## Decisions

### 1. Drizzle + Postgres (Neon)

Drizzle gives SQL-shaped queries with inferred TS types (no codegen), first-class Postgres
enums/jsonb, and migrations we can read in review. Neon provides branch-per-preview databases.

### 2. Services are a table, not jsonb

The brief sketched `businesses.services jsonb`. Rejected: bookings must reference a service with
referential integrity, price snapshots need a source of truth, and analytics ("revenue saved")
aggregate over services. `services` is a first-class table; `hours` and `prompt_config` remain
jsonb on `businesses` (validated by zod schemas in `packages/shared` — they're config blobs, not
relational data).

### 3. Money is integer paise

All monetary columns are `*_paise` integers (INR minor unit — the brief said "cents"; paise is
the correct minor unit for an India-only MVP). No floats, ever. Formatting to "₹1,200" happens
at the edge (`formatINR` in shared). If multi-currency ever lands, add a `currency` column then.

### 4. Timestamps are UTC `timestamptz`; business-local time is derived

Bookings/calls store UTC instants. Each business has a `timezone` (default `Asia/Kolkata`).
Weekly opening hours are stored business-local (minutes from midnight) in jsonb; the pure
availability engine (`packages/core`) converts via an Intl-based tz utility — no tz dependency.

### 5. Tenant isolation lives in the DAL, nowhere else

Every tenant-owned table carries `business_id NOT NULL`. `packages/db` exposes:

- `dal.system` — deliberately narrow unscoped operations (webhook dedupe, business lookup by
  phone number, auth).
- `dal.forBusiness(businessId)` — returns repositories whose every query is pre-scoped; the
  business id is closed over at construction and appended to every `where`. Routes and services
  receive an already-scoped DAL from auth middleware and _cannot_ express a cross-tenant query.

Row-level security was considered and deferred: RLS + connection pooling (Neon, serverless
drivers) complicates session GUCs, and the DAL boundary is testable directly. RLS can be layered
on later as defense-in-depth without changing callers.

### 6. Idempotency and dedupe are schema-level

- `bookings(business_id, idempotency_key)` UNIQUE — the agent retrying `create_booking` (network
  blip, LLM retry) can never double-book; the DAL returns the existing row as `duplicate`.
- `webhook_events(provider, event_id)` UNIQUE — replayed telephony/WhatsApp webhooks short-circuit.
- `calls(provider, provider_call_id)` UNIQUE — status callbacks upsert the same row.

### 7. Table inventory

`users`, `accounts`, `sessions`, `verification_tokens` (Auth.js-compatible) · `businesses` ·
`memberships` (role: owner/staff) · `services` · `resources` · `bookings` (status/source enums,
price snapshot, idempotency) · `calls` (direction/status/outcome, cost+latency+token rollups) ·
`call_turns` (role, text, tool_calls jsonb, audio_url, per-stage latency) · `webhook_events` ·
`eval_cases` / `eval_runs` / `eval_results` · `audit_log`.

## Consequences

- A new tenant-owned table must be added to the scoped DAL to be reachable at all — isolation by
  construction, verified by unit tests that assert emitted SQL always binds `business_id`.
- Availability reads and booking writes re-check overlap inside one transaction, so
  "slot taken between check and create" degrades to a structured tool error, never a double-book.

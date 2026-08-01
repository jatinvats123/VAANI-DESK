# Phase 0 — Gap Audit

Read-only assessment of the current codebase against "a product a business can pay for."
Nothing in this document was changed in code. Every file:line is real. Every unmeasured number
is written as `TODO(measure-required)` per the honesty contract.

Audited at: commit `main` (20 commits), no phase work started.
Remote: `github.com/jatinvats123/VAANI-DESK`.

---

## 1. API routes — auth, tenant scoping, rate-limit coverage

Legend: **Session** = Auth.js cookie (`requireUser`); **Membership** = session + business
membership, attaches `request.tenant` (`requireMembership`); **Owner** = membership with owner
role; **Service** = gateway shared-secret bearer (`requireServiceToken`); **Sig** = provider
signature/token verification.

| Route | Method | Auth | Tenant-scoped? | Rate-limited? |
|---|---|---|---|---|
| `/healthz`, `/readyz` | GET | none (public) | n/a | no (allowlisted) |
| `/v1/me` | GET | Session | user-scoped (lists own memberships) | yes |
| `/v1/businesses` | POST | Session | user-scoped (creates + owner membership) | yes |
| `/v1/businesses/:businessId` | GET | Membership | ✅ | yes |
| `/v1/businesses/:businessId` | PATCH | Owner | ✅ | yes |
| `/v1/businesses/:businessId/analytics` | GET | Membership | ✅ | yes |
| `/v1/businesses/:businessId/complete-onboarding` | POST | Owner | ✅ | yes |
| `/v1/businesses/:businessId/availability` | GET | Membership | ✅ | yes |
| `/v1/businesses/:businessId/bookings` (+ `/:id`, cancel, reschedule, status) | GET/POST | Membership | ✅ | yes |
| `/v1/businesses/:businessId/calls` (+ `/:id`, `/:id/recording-url`) | GET | Membership | ✅ | yes |
| `/v1/businesses/:businessId/services` (+ CRUD) | GET/POST/PATCH | Membership / Owner | ✅ | yes |
| `/v1/businesses/:businessId/resources` (+ CRUD) | GET/POST/PATCH | Membership / Owner | ✅ | yes |
| `/v1/internal/*` (context, 3 tools, answered, turns, transfer, callbacks, complete) | GET/POST | Service | body `businessId` → scoped DAL | **no** (allowlisted) |
| `/webhooks/telephony/twilio/*` | POST | Sig (HMAC-SHA1) | resolved from payload | no (allowlisted) |
| `/webhooks/telephony/exotel/*` | GET/POST | Sig (shared token) | resolved from payload | no (allowlisted) |
| `/webhooks/whatsapp` | GET/POST | Sig (HMAC-SHA256 raw body) | resolved from payload | no (allowlisted) |
| `/ws/live-calls` | GET (WS) | Session + membership on `businessId` | ✅ (see §2) | no |

**Finding — no tenant-data route is reachable without a tenant scope.** This is the audit's
best news. `/v1/me` and `POST /v1/businesses` are deliberately user-scoped and expose no other
tenant's data. Every `/v1/businesses/:businessId/*` route runs `requireMembership`, which throws
the *same* 403 for "not a member" and "no such business" (no tenant enumeration) —
`apps/api/src/plugins/auth.ts:56-63`.

**Rate-limit gaps (not security-critical, but real):**
- Limit is **300/min per IP**, Redis-backed (`apps/api/src/server.ts:55-67`). It is **per-IP,
  not per-user or per-business**. Multiple staff behind one NAT share a bucket; a distributed
  attacker across IPs is not throttled per account.
- `/v1/internal/*` is **entirely exempt** from rate limiting (`server.ts:62-66`). Justified
  today (single trusted caller, its own auth), but if `INTERNAL_SERVICE_SECRET` ever leaks there
  is no throttle — see risk #7.

---

## 2. Tenant-DAL bypass surfaces

The scoped DAL (`dal.forBusiness(id)`) is the isolation boundary. Places that can touch the DB
*outside* it:

1. **`apps/api/src/plugins/auth.ts:24-31` — raw `db.select` on `sessions`/`users`.**
   Legitimate: identity resolution must precede tenancy. Not a tenant-data bypass.
2. **`apps/web/src/lib/db.ts:16-23` — `getDb()` returns BOTH `db` and a full `dal` inside the
   web process.** Today only `.db` is used, by the Auth.js DrizzleAdapter for the auth tables
   (`apps/web/src/auth.ts:16`). **Latent risk:** the web process holds a direct DB handle and a
   `createDal` capability, so a future server action could call `getDb().dal.forBusiness(x)` or
   raw `db` and bypass the API's membership guards entirely. No exploit today; architecture
   should hand web only an auth-tables handle. (Risk #3.)
3. **`/v1/internal/*` trusts the gateway-supplied `businessId` in the request body.** The scoped
   DAL still prevents cross-tenant *reads* (a mismatched id returns "not found"), so this is not
   an isolation hole. But **metering and billing integrity will depend on the gateway reporting
   the correct `businessId` and honest usage** — relevant to Phase 1.

**Verdict: tenant isolation is structurally sound at the API boundary. The web direct-DAL handle
is the one thing to tighten before more server actions are added.**

---

## 3. The two `not implemented for provider` paths

Both live in `apps/api/src/modules/internal/routes.ts`.

### Transfer to human — line 289, gap at **308**
```
if (call.provider !== "twilio") throw AppError.conflict(`Transfer not implemented for provider "${call.provider}"`)
```
- **Twilio:** implemented — `redirectCallToDial` to `<Dial>ownerPhone</Dial>` (needs
  `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN`; absent → 503 mid-call, line 312).
- **Exotel:** not implemented → 409.
- **Missing:** Exotel warm/cold transfer; a **spoken fallback** when transfer 409/503s (today the
  gateway receives an error — a caller who asked for a human may get silence or a generic
  apology instead of a person). No provider capability matrix.

### Missed-call auto-callback — line 346, gap at **359**
```
if (call.provider !== "twilio") throw AppError.conflict(`Callback not implemented for provider "${call.provider}"`)
```
- **Twilio:** implemented — `createOutboundCall`, guarded by open-hours + "already booked"
  re-checks (lines 362-372). Good discipline.
- **Exotel:** not implemented → 409.
- **Missing:** Exotel outbound callback; graceful capability check rather than a 409.

Both belong to **Phase 5** (finish provider gaps, capability matrix, spoken degraded mode).

---

## 4. Eval execution reality

**The 30 scenarios have never been executed against a real model. There is no recorded pass
rate.**

- The CI eval job is gated on a secret: `.github/workflows/ci.yml:130-141` checks
  `secrets.ANTHROPIC_API_KEY`; when absent it prints `eval gate skipped` and runs nothing.
- No `ANTHROPIC_API_KEY` / `EVALS_DATABASE_URL` has ever been configured (no live run in project
  history; nothing deployed).
- No `docs/EVAL-RESULTS.md` exists. `eval_runs` / `eval_results` tables are defined and empty.
- What *is* proven: the eval **harness code** — assertions, tool-executor, 30-scenario integrity
  — passes its own unit tests. The agent's **actual behavior against Claude is unverified.**

Last recorded pass rate: **none.** Any pass-rate number anywhere today would be fabricated →
`TODO(measure-required)`. This is the single biggest honesty gap for an interview or a customer.

---

## 5. Everything a paying customer needs that does not exist

| Capability | State | Phase |
|---|---|---|
| Billing / subscriptions / payments | **Zero code.** No plans, no Razorpay/Stripe, no invoices. | 1 |
| Usage metering | Partial — only **LLM cost** is computed & stored (`session.ts:825-840`, `calls.total_cost_paise`). **No STT seconds, TTS characters, telephony minutes, or WhatsApp sends** are metered or costed. No nightly roll-up. | 1 |
| Plan enforcement at call admission | **None.** The gateway answers every call unconditionally — no way to gate a business over its included minutes. | 1 |
| Self-serve number provisioning | **None.** No search/purchase/configure/release; onboarding cannot give a business a working number. | 2 |
| Runtime observability | **None at runtime** — no `/metrics`, no tracing, no Sentry, no alerts. Docs describe measurement; the runtime does not implement it. | 3 |
| Cost-per-call visibility (dashboard) | Partial (LLM only, shown on call detail). No true unit economics. | 1/3 |
| Data lifecycle / DPDP compliance | Consent is **spoken** but not **persisted per call**. No retention policy, no per-caller deletion, no PRIVACY/DPA docs, no sub-processor map. Recordings signed (15-min) but **no server-side-encryption header on upload** (`calls/recordings.ts`). | 4 |
| Provider failover / circuit breakers | **None.** Single STT/TTS/LLM path; TTS failure mid-call = silence. Sarvam key present in env but unwired. | 5 |
| Admin / superadmin console | **None.** No cross-tenant operations view. | 6 |
| Public marketing site + self-serve signup | **None.** `apps/web/src/app/page.tsx` redirects to `/login`. A stranger cannot understand or buy this. | 7 |
| Retention features (digest, missed-call rescue, calendar sync, etc.) | **None.** | 8 |
| Measured latency / concurrency / cost numbers | **None.** All are `TODO(measure-required)`. | 9 |
| Verified gateway drain + distributed locking across replicas | Drain logic exists; multi-replica safety **unverified**. | 5 |

---

## 6. Top 10 riskiest lines

Ranked by blast radius × likelihood, for a paying-customer context.

1. **`apps/voice-gateway/src/call/session.ts` (`begin()`, ~line 130)** — no call-admission gate.
   Every call runs the full paid pipeline unconditionally → **unbounded provider spend per
   business, no way to enforce a plan.** The core reason there is no business yet. (Phase 1.)
2. **`apps/api/src/modules/internal/routes.ts:308`** — transfer 409 for non-Twilio. A live
   caller asking for a human on Exotel gets a hard error, not a person. Trust-foundation UX risk.
3. **`apps/api/src/modules/internal/routes.ts:359`** — callback 409 for non-Twilio. Missed-call
   revenue-rescue silently unavailable on Exotel.
4. **`apps/web/src/lib/db.ts:22`** — web process holds a full `dal` + raw `db`. One careless
   server action bypasses every API membership guard. Tenant isolation is a security boundary;
   this is the one place it could erode. (Risk #2 above.)
5. **`apps/api/src/plugins/auth.ts:69-79`** — a single global `INTERNAL_SERVICE_SECRET`
   authorizes actions for **any** business. Gateway compromise = all-tenant blast radius, and
   Phase-1 billing integrity rests on this secret + honest `businessId` reporting.
6. **`.github/workflows/ci.yml:137`** — the eval "quality gate" is a **no-op without a secret**.
   CI can go green while never testing the agent. False sense of safety on the product's core.
7. **`apps/api/src/server.ts:62-66`** — `/v1/internal/*` fully exempt from rate limiting. No
   throttle if the service secret leaks.
8. **`apps/api/src/modules/internal/routes.ts:312`** (and callback :374) — missing Twilio REST
   creds throw **503 mid-call** with no spoken fallback to the caller.
9. **`apps/api/src/modules/calls/recordings.ts:36`** — signed URLs expire (15 min, good) but
   **no `ServerSideEncryption` on the S3 objects at upload** — recordings-at-rest encryption
   relies on bucket default, unverified in code. PII exposure risk under DPDP. (Phase 4.)
10. **`apps/voice-gateway/src/call/session.ts:840`** — only `llmPaise` is recorded as call cost.
    **STT/TTS/telephony/WhatsApp cost is invisible**, so a runaway-cost tenant is undetectable
    until the provider invoice arrives. Blocks pricing decisions. (Phase 1.)

---

## 7. Workflow note

- A git **remote is configured** (`jatinvats123/VAANI-DESK`) and there are 20 commits on `main`.
- Per the engineering constraints I will branch per phase (`feat/phase-N-*`) and **never commit
  to `main` directly**. I have **not pushed anything**; opening PRs will need your go-ahead
  since it is an outward-facing action on your public repo.

## 8. Recommended entry point

Your execution order is **Phase 3 (observability) → 9 → 1 → 7 → 2 → rest**. Starting with
observability is the right call: you cannot honestly fill the `TODO(measure-required)` tokens in
Phases 1 and 9 (cost per call, latency percentiles, concurrency ceiling) until the runtime
actually measures them. Phase 3 is what makes the later honesty possible.

> **Update (addendum §9 below):** the operator has no Anthropic API key and cannot buy credits.
> A new **Phase 3.5** (after Phase 3) swaps the LLM to Gemini free tier by default, keeping
> Anthropic env-selectable. The "minimum keys" list below is therefore rewritten for **free
> tiers only**, with the free-tier breakage flags the operator asked for.

---

## 9. Free-tier provisioning — minimum keys and what silently breaks

Assumption: **free/trial tiers only** (Gemini free, Deepgram signup credit, ElevenLabs free,
Twilio trial, Meta WhatsApp test number). Enough for **one demo call**; several things degrade
or break under concurrency or repeated runs. Each flag is a real code path.

### Minimum keys for one end-to-end call (free-tier edition)

| Provider | Key(s) | Free-tier reality |
|---|---|---|
| **LLM — Gemini** (after Phase 3.5) | `GEMINI_API_KEY`, `AGENT_MODEL=gemini-2.5-flash-lite` (or similar) | Free: ~15–30 RPM, ~1,500 requests/day. **Not Anthropic** — that has no free tier and is the reason for the swap. |
| **STT — Deepgram** | `DEEPGRAM_API_KEY` | Signup credit, then paid. Streaming WS works on credit; credit drains per audio-minute. |
| **TTS — ElevenLabs** | `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID` (no default) | Free: ~10k credits/mo, **~2 concurrent requests**, streaming/commercial use restricted, attribution required. |
| **Telephony — Twilio** | Twilio number, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, webhooks → `PUBLIC_API_URL`, `GATEWAY_STREAM_URL` | Trial: **verified numbers only**, **trial notice plays before our greeting**, limited credit. |
| **WhatsApp — Meta** | `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN` + 3 approved templates | Test number: **only pre-registered recipients (≤5)**; templates still need approval. |
| **Infra/wiring** | `DATABASE_URL`, `REDIS_URL`, `INTERNAL_SERVICE_SECRET` (same in api+gateway), `API_BASE_URL`, business row with `phone_number` = your Twilio number | Local. |

### What breaks or silently degrades under free limits

1. **Anthropic — hard blocker (no free tier).** `createAnthropicClient` is the current default
   (`apps/voice-gateway/src/providers/llm.ts`, `packages/evals/src/llm.ts` + `judge.ts`).
   Without a key, **no call and no eval can run.** → Fixed in Phase 3.5.
2. **Gemini free-tier RPM vs live-call turn rate — will 429 mid-call under load.** The gateway
   makes ≥1 LLM request per turn plus up to **3 tool rounds/turn**
   (`MAX_TOOL_ROUNDS_PER_TURN = 3`, `apps/voice-gateway/src/call/session.ts`). A lively call can
   approach or exceed **15 requests/minute inside a single call.** Free tier is fine for **one**
   demo call; **concurrent calls will hit 429s.** Phase 3.5 adds 429 backoff, but on a live
   voice call a retry injects audible latency — so free-tier Gemini is a demo tool, not a
   concurrency story. Flag honestly in `LIMITATIONS.md` later.
3. **Gemini daily quota vs eval suite — a few full runs exhausts the day.** One full 30-scenario
   run is roughly `Σ turns + tool rounds + one judge call per scenario` ≈ **150–350 requests**
   (`TODO(measure-required)` — exact count depends on model behaviour). Against **1,500 RPD**
   that is **~4–8 full runs/day maximum.** CI must not loop the suite. Phase 3.5 documents a
   realistic cadence (e.g. run on PRs touching `packages/agent`/`evals` only, not every push).
4. **ElevenLabs free concurrency (~2) caps concurrent calls hard.** The gateway opens one TTS
   stream-input socket per agent utterance (`apps/voice-gateway/src/providers/tts.ts`). Beyond
   ~2 simultaneous calls, TTS requests fail → **silence on a live call** (there is no TTS
   fallback yet; that is Phase 5). Fine for one demo caller.
5. **Twilio trial notice plays before our recording-consent greeting.** On a trial account the
   caller hears Twilio's "trial account" message first, then our
   greeting+consent (`buildGreeting`). It does not break the flow but it front-loads the demo and
   muddies the consent UX — worth knowing before recording the Phase 9 video.
6. **WhatsApp test number only messages registered testers.** A confirmation to any other number
   returns a permanent 4xx, which the worker correctly treats as an **audited skip, not a crash**
   (`apps/workers/src/whatsapp/client.ts` — retryable vs permanent split). So the *call* still
   succeeds; the confirmation just won't arrive except to pre-registered recipients.
7. **Deepgram credit depletion is silent to the product.** No metering of STT seconds exists yet
   (see §5), so you learn you're out of credit from Deepgram, not from VaaniDesk. Phase 1
   metering closes this.

**Net:** free tiers are enough to place and record **one** honest end-to-end demo call and to
establish a **first eval baseline** with a handful of runs. They are not enough to prove
concurrency, and every concurrency claim stays `TODO(measure-required)` until a paid tier exists.

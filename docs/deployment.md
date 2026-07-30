# Deployment

Topology per docs/architecture.md §5: stateless web/api scale wide, the stateful voice-gateway
scales tall with drain, workers scale by queue depth.

## Environments

| Env       | Infra                                                               | Keys                     |
| --------- | ------------------------------------------------------------------- | ------------------------ |
| `dev`     | docker-compose (Postgres + Redis), services via `pnpm dev`          | `.env` (never committed) |
| `preview` | Vercel preview + Neon branch DB + shared Upstash                    | per-PR platform env      |
| `prod`    | Vercel (web) · Railway/Fly (api, gateway, workers) · Neon · Upstash | platform secrets only    |

Every environment uses distinct provider keys (Twilio subaccounts, separate Meta apps,
separate Anthropic keys) — see `.env.example` for the full variable inventory.

## Web — Vercel

- Root directory `apps/web`; install `pnpm install --frozen-lockfile` at repo root
  (Vercel's monorepo support handles this); build `pnpm --filter @vaanidesk/web build`.
- Required env: `DATABASE_URL`, `AUTH_SECRET`, `AUTH_GOOGLE_ID/SECRET`, `AUTH_RESEND_KEY`,
  `AUTH_EMAIL_FROM`, `API_INTERNAL_URL`, `NEXT_PUBLIC_API_WS_URL`.

## api / voice-gateway / workers — containers

Each has a monorepo-aware Dockerfile; **build from the repo root**:

```sh
docker build -f apps/api/Dockerfile -t vaanidesk-api .
docker build -f apps/voice-gateway/Dockerfile -t vaanidesk-gateway .
docker build -f apps/workers/Dockerfile -t vaanidesk-workers .
```

Full local stack: `docker compose --profile apps up --build`.

Operational notes:

- **api**: N replicas behind the LB; health at `/readyz` (checks Postgres+Redis). Set
  `PUBLIC_API_URL` to the public HTTPS origin — Twilio signatures are computed over it.
- **voice-gateway**: give the platform a stop grace period ≥ `DRAIN_TIMEOUT_MS` (default 5m);
  the process refuses new calls and lets live ones finish on SIGTERM. Deploy in `ap-south`
  (nearest to Twilio India media) per the latency budget. One WS = one call; scale by
  concurrent-call count, not CPU.
- **workers**: scale by queue depth; SIGTERM waits for in-flight jobs.

## Database migrations

Migrations are applied explicitly, never on boot:

```sh
DATABASE_URL=<target> pnpm db:migrate
```

CI applies to preview branches; prod migration is a manual release step before rolling services.

## Provider wiring checklist

1. Twilio number → voice webhook `POST {PUBLIC_API_URL}/webhooks/telephony/twilio/voice`,
   status callback `/webhooks/telephony/twilio/status`.
2. `GATEWAY_STREAM_URL` → the gateway's public `wss://…/stream`.
3. Meta app → webhook `{PUBLIC_API_URL}/webhooks/whatsapp` with `WHATSAPP_WEBHOOK_VERIFY_TOKEN`;
   subscribe to `messages`. Approve the three templates named in `.env.example` (ADR-0006).
4. GitHub secrets for CI: `ANTHROPIC_API_KEY`, `EVALS_DATABASE_URL` (a dedicated Neon branch).

## CI/CD

`.github/workflows/ci.yml`: lint → typecheck → unit tests → web build, dependency audit, and
the eval suite with the pass-rate gate vs main (ADR-0007). `nightly.yml` re-runs the full suite
on main every night at 03:00 IST to keep the baseline fresh. Deploys: Vercel auto-deploys web
per branch; container platforms deploy on main via their GitHub integrations (Dockerfiles
above) — promotion to prod is a platform-side approval, keeping this repo CI vendor-neutral.

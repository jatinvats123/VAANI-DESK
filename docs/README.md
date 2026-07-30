# VaaniDesk Documentation

Everything written about this project, organized by who is reading and why.

---

## 🏗️ Understand the system

| Document                                 | What it answers                                                                                        |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| [`architecture.md`](architecture.md)     | The topology diagram, the full call sequence diagram, folder layout, multi-tenancy, and deployment map |
| [`latency-budget.md`](latency-budget.md) | Per-stage voice timing targets and how they're measured                                                |
| [`deployment.md`](deployment.md)         | Environments, provider wiring checklist, container builds, migration policy                            |

## 🧭 Decisions and their reasoning (ADRs)

An **Architecture Decision Record** captures one significant choice: the context, the decision,
the alternatives rejected, and the consequences. Read these when you want to know _why_
something is the way it is — or when an interviewer asks.

| ADR                                             | Decision                                                                |
| ----------------------------------------------- | ----------------------------------------------------------------------- |
| [0001](adr/0001-monorepo-layout-and-tooling.md) | Monorepo layout, pnpm + Turborepo, TS source without a build step       |
| [0002](adr/0002-two-service-topology.md)        | Stateful voice gateway split from the stateless API                     |
| [0003](adr/0003-database-and-tenancy.md)        | Drizzle + Postgres, integer paise, UTC time, tenancy in the DAL         |
| [0004](adr/0004-api-auth-and-validation.md)     | Auth surfaces, zod validation, the typed error envelope, advisory locks |
| [0005](adr/0005-voice-gateway-design.md)        | Audio format, provider interfaces, state machine, barge-in, drain       |
| [0006](adr/0006-async-jobs-and-whatsapp.md)     | BullMQ contracts, best-effort enqueue, WhatsApp templates, webhooks     |
| [0007](adr/0007-eval-harness.md)                | Eval design: hard assertions + LLM judge, in-memory executor, CI gate   |

---

## Quick reference

**Run everything locally**

```sh
docker compose up -d          # Postgres + Redis
pnpm db:migrate && pnpm db:seed
pnpm --filter @vaanidesk/api dev            # :4000
pnpm --filter @vaanidesk/web dev            # :3000
pnpm --filter @vaanidesk/voice-gateway dev  # :4100 (needs AI provider keys)
pnpm --filter @vaanidesk/workers dev        # background jobs
```

**Check everything**

```sh
pnpm lint && pnpm typecheck && pnpm test    # 27 tasks, 173 unit tests
pnpm --filter @vaanidesk/api test:integration   # needs Docker
pnpm --filter @vaanidesk/web e2e                # Playwright
pnpm --filter @vaanidesk/evals run -- --no-db   # 30 AI scenarios (needs ANTHROPIC_API_KEY)
```

**The five files worth reading first**

1. `apps/api/src/modules/bookings/service.ts` — the booking invariant
2. `apps/voice-gateway/src/call/session.ts` — the live-call orchestrator
3. `packages/agent/src/prompt.ts` — how the AI is instructed
4. `packages/db/src/dal/tenant.ts` — how tenant isolation is enforced
5. `packages/evals/src/scenarios/guardrails.ts` — how the AI is held accountable

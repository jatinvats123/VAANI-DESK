# ADR-0001: Monorepo layout and tooling

Date: 2026-07-17 · Status: Accepted

## Context

VaaniDesk spans four deployables (web dashboard, REST api, voice gateway, queue workers) and a
set of libraries (domain logic, DB layer, agent, evals) that must share types end-to-end — a zod
schema written once should validate a Fastify route, type a fetch call in Next.js, and shape a
tool definition sent to the LLM.

## Decision

**pnpm workspaces + Turborepo**, with a strict split:

- `apps/*` — deployable services. Includes `api`: the original brief placed the Fastify service
  under `packages/`, but a deployable with its own Dockerfile, env contract, and release cadence
  belongs in `apps/`; `packages/` is reserved for code that is _imported_, never deployed.
- `packages/*` — libraries only: `shared`, `core`, `db`, `agent`, `evals`.

Supporting decisions:

- **Internal packages ship TypeScript source** (`"exports": { ".": "./src/index.ts" }`), no build
  step. Next.js consumes them via `transpilePackages`; Node services run through `tsx` in dev and
  bundle with esbuild for deploy. This removes an entire class of stale-dist bugs and keeps
  `turbo dev` instant. Trade-off: every consumer typechecks package source — acceptable at this
  repo size, revisit if cold typecheck exceeds ~60s.
- **TypeScript strict** plus `noUncheckedIndexedAccess`, `verbatimModuleSyntax`. No `any`
  (lint-enforced).
- **One flat ESLint config at the root** (typescript-eslint type-checked preset) instead of
  per-package config packages — less boilerplate, single source of truth.
- **pnpm catalog** pins versions of cross-cutting deps (typescript, zod, vitest, drizzle-orm) so
  packages can't drift.
- **Vitest** per package for unit tests; Turborepo caches `test`, `lint`, `typecheck`, `build`.

## Consequences

- Shared zod schemas + Drizzle inferred types give end-to-end type safety with zero codegen.
- `core` stays dependency-free and pure, so the availability engine tests run in milliseconds.
- The one deviation from the brief (`api` in `apps/`) is deliberate and documented here.

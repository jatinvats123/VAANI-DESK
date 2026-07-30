# ADR-0007: Eval harness design

Date: 2026-07-18 · Status: Accepted

## Context

"Trust > cleverness" is only enforceable if agent behavior is tested like code. The brief makes
the 30-scenario suite a first-class deliverable with a CI gate.

## Decisions

### 1. Evals test the conversation layer, not the audio layer

The harness drives the **production prompt** (`assembleSystemPrompt`), the **production tool
definitions** (`buildAnthropicTools`/`parseToolUse`), and the **production guardrail reducer**
through a lean runner that mirrors the gateway's loop semantics (tool rounds capped at 3,
control tools, abuse warn-then-end). STT/TTS/latency are exercised by the gateway's unit tests
and production metrics — evals assert what the agent _says and does_.

### 2. Tools run against an in-memory executor built on the same pure engine

`InMemoryToolExecutor` implements check/create/cancel with `computeDaySlots`,
`isWindowBookable`, and `windowWithinBusinessHours` from `@vaanidesk/core` — the identical slot
math the api runs — plus api-shaped responses (alternatives on conflict, disambiguation
candidates). No Postgres/api dependency keeps a 13-scenario run under a minute and CI-cheap,
while the engine reuse prevents semantic drift. The api's own correctness is covered separately
(unit now, testcontainers integration next).

### 3. Scenarios are repo-versioned TypeScript, synced to the DB at run time

Typed fixtures + scripted callers + a typed `HardAssertion` union — reviewable in PRs, no YAML
drift, upserted into `eval_cases` by stable name so the dashboard can trend per-case history.
Clock pinned (Fri 2026-07-17 14:00 IST) so relative dates are deterministic forever.
Currently 13 scenarios; the remaining 17 to reach the brief's 30 are enumerated in
`scenarios/index.ts`.

### 4. Two-layer verdict: hard assertions gate, judge scores

Hard assertions are deterministic and non-negotiable (booking existence, `no_unauthorized_amounts`
via the same `findUnauthorizedAmounts` guardrail the gateway logs, transfer/end behavior, tool
usage, turn budget). The LLM judge (forced tool-call output, temperature 0, rubric weighted
40% correctness) can fail a scenario below 0.7 but can never rescue a failed assertion.

### 5. CI gate compares against main's stored baseline

Runs persist to `eval_runs`/`eval_results` with git sha/branch. `--gate` queries main's latest
completed pass rate and fails the build on a drop > 5 percentage points (brief's threshold).
No baseline yet → gate passes with a notice (bootstrapping).

## Consequences

- `pnpm --filter @vaanidesk/evals run -- --trigger ci --gate` is the single CI entry point;
  cost per full run is logged in paise and stored per case.
- Executor and assertion evaluator are pure and unit-tested — harness bugs don't masquerade as
  agent regressions.

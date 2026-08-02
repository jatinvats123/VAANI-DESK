# ADR-0009: Provider-agnostic LLM (Gemini + Anthropic, env-selected)

Date: 2026-08-02 · Status: Accepted

## Context

The agent and eval harness were hardwired to Anthropic (`@anthropic-ai/sdk`). Running the product —
even a demo — therefore required a paid Anthropic API key. We have none, and are not in a position
to buy credits, so **no scenario had ever run against a real model** (docs/GAP-AUDIT.md §5): every
pass-rate number was `TODO(measure-required)`.

Google's Gemini API has a genuinely free tier, which is enough to demo the product and produce the
first real measurements. We need Gemini to power local development, the live demo, and evals —
**without** removing Anthropic (it remains the stronger option once there's a budget) and without
rewriting the agent, which is built around Anthropic message/content-block shapes.

## Decision

### 1. One `LlmClient` interface, two implementations

The gateway's `LlmClient` (streaming) and the harness's `EvalLlm` (non-streaming) are unchanged.
Gemini slots in behind them as an additional implementation. The whole system keeps speaking
Anthropic message shapes; a **pure, SDK-free bridge** in `@vaanidesk/agent` (`gemini.ts`) converts
both ways:

- `toGeminiContents` / `fromGeminiParts` — message history, including
  `tool_use ⇄ functionCall` and `tool_result ⇄ functionResponse` (Gemini keys responses by name,
  Anthropic by id, so the bridge resolves the name from the matching tool-use id). It also preserves
  the `thought_signature` Gemini's thinking models attach to function-call parts — a real run
  (Phase 9) showed the follow-up turn is rejected with `400` if it isn't echoed back, so the bridge
  stashes it on the (otherwise Anthropic-shaped) tool_use block and round-trips it through history.
- `buildGeminiTools` / `jsonSchemaToGeminiSchema` — the zod-derived tool schema adapted to Gemini's
  OpenAPI subset (uppercased types, validation keywords Gemini rejects stripped).

Keeping the bridge pure means it is unit-tested without a network and `@vaanidesk/agent` stays free
of the Google SDK; only the gateway and evals depend on `@google/genai`.

### 2. Provider chosen by environment, not by code

`LLM_PROVIDER` (`anthropic` | `gemini`, default `anthropic`) selects the backend; a factory
validates that **only the selected provider's key** is present. So a free-tier Gemini setup runs
with no Anthropic key at all — the previously-required `ANTHROPIC_API_KEY` is now optional
(this was flagged in Phase 0 as a startup-blocking, free-tier-hostile default). The eval CI mirrors
this: it prefers `GEMINI_API_KEY` when set, else `ANTHROPIC_API_KEY`, else skips the gate cleanly.

### 3. Free-tier limits handled explicitly

`classifyGeminiError` + `callWithGeminiRetry` distinguish the failure modes the free tier actually
produces:

- **per-minute rate limit** → retry with exponential backoff + jitter;
- **daily-quota / `limit: 0`** → fail clean via `GeminiDailyQuotaError`, never hammer;
- **5xx / network** → retry; **auth / 400** → surface immediately.

In the **voice path** retries are few and only happen *before the first spoken token* — retrying
mid-utterance would double-speak. In **evals** retries are generous (throughput over latency).

### 4. Free-tier reality (measured 2026-08-02)

Verified live against the real API with our key:

- Auth works; **text generation and usage metadata round-trip correctly** end to end.
- **The `-latest` aliases carry free-tier quota; the pinned `gemini-2.0-flash*` models return a hard
  `generate_content_free_tier_requests, limit: 0`.** So the default model is **`gemini-flash-lite-latest`**,
  not a pinned 2.0 id. The `gemini-2.5-*` ids are "no longer available to new users".

### 5. Data-training caveat (must not be skipped before real customers)

Google may use **free-tier** Gemini API data to improve its products. That is acceptable for demos
and synthetic eval fixtures, but **not** for real caller PII. Before onboarding a paying customer on
Gemini we must move to a paid tier or Vertex AI (no training on request data) — and override the
`0`-paise free-tier pricing in `DEFAULT_MODEL_PRICING` with the real rates so cost accounting stays
honest. Until then, Gemini is for demo/eval only; Anthropic remains available via `LLM_PROVIDER`.

## Consequences

- The demo path and evals can finally run against a real model at zero cost, unblocking Phase 9's
  real measurements — with the honest caveat that those numbers come from `gemini-flash-lite-latest`
  on the free tier, not a production-grade paid model.
- Adding a third provider later is a new `LlmClient`/`EvalLlm` implementation plus a bridge; the
  agent, session, and scenarios don't change.
- The free-tier daily cap (and `limit: 0` on some models) can halt a long eval run; the harness
  fails clean and says which quota was hit rather than hanging or inventing results.

# Latency budget — voice turn

Target: **p50 ≤ 1.2s, p95 ≤ 2.5s** from caller end-of-speech to first audio byte of the reply
("voice-to-voice" latency). Every stage below is measured per turn and persisted in
`call_turns.metrics`; rollups land in `calls.latency_metrics`.

## Per-turn pipeline and budget

| #   | Stage                               | Measured as             | p50 budget | Notes                                                                                                                                         |
| --- | ----------------------------------- | ----------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Caller end-of-speech → STT endpoint | `stt_endpoint_ms`       | 250ms      | Deepgram endpointing ~200–300ms; tune `endpointing` + `utterance_end_ms`. Partials stream throughout (0 added latency — they overlap speech). |
| 2   | STT final → LLM request sent        | `prep_ms`               | 10ms       | Prompt already assembled at call start; per-turn we only append messages.                                                                     |
| 3   | LLM time-to-first-token             | `llm_ttft_ms`           | 400ms      | Streaming always on. Haiku-class model. Tool-call turns pay this twice (see below).                                                           |
| 4   | First sentence chunk → TTS request  | `chunking_ms`           | 5ms        | Sentence-boundary chunker feeds TTS as tokens stream — we do NOT wait for the full completion.                                                |
| 5   | TTS time-to-first-byte              | `tts_ttfb_ms`           | 300ms      | Streaming synthesis; keep a warm connection per call.                                                                                         |
| 6   | Gateway → Twilio → caller ear       | `network_out_ms` (est.) | 150ms      | Mostly fixed PSTN/media path; gateway must be in ap-south or nearest region.                                                                  |
|     | **Total (no tool call)**            | `turn_total_ms`         | **~1.1s**  |                                                                                                                                               |

## Tool-call turns

`check_availability` / `create_booking` insert: LLM emits tool_use (≈ttft + tool tokens), api
executes (DB query ≤30ms + HTTP hop ≤15ms), then a second LLM streaming round. Budget:
**p50 ≤ 2.0s**. Mitigation: the gateway plays a natural filler ("एक second, देख रही हूँ…") via
pre-synthesized audio the moment a tool_use block starts streaming — perceived latency stays low
while real latency is paid behind speech.

## Measurement discipline

- The gateway stamps `performance.now()` at every stage boundary; each turn's metrics object is
  posted with the turn record — no sampling, every turn of every call.
- `calls.latency_metrics` stores per-call p50/p95 per stage; the analytics page trends them.
- Regressions: eval harness runs assert `turn_total_ms` p50 against fixtures with mocked
  providers (pipeline overhead only); provider latencies are monitored from production metrics.

## Standing rules

1. Never buffer a full LLM completion before starting TTS.
2. Never buffer full TTS audio before starting playback.
3. Barge-in: caller speech during playback cancels TTS + flushes the jitter buffer within 100ms.
4. Any stage breaching 2× its p50 budget logs a structured warning with call id for triage.

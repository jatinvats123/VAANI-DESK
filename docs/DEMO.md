# Demo guide

Two ways to see VaaniDesk work, depending on what credentials you have.

- **A. Text demo (no telephony, ~free)** — drive the real agent brain on Gemini through the eval
  harness. Proves grounding, tools, and booking end to end. Needs only `GEMINI_API_KEY`.
- **B. Live phone call (full pipeline)** — a real caller dials a number and books. Needs the voice
  providers below and is what you record for the demo video.

> Status (2026-08-02): the three providers for **B** — Gemini, Deepgram, ElevenLabs — are all
> validated working with real credentials (see [MEASUREMENTS.md](MEASUREMENTS.md)). The only things
> still blocking a real inbound call are on the Twilio side: a **voice-capable phone number** (none
> is provisioned) and the account being on **Trial**. Live voice-to-voice latency and telephony
> cost remain `TODO(measure-required)` until a real call runs over B.

---

## A. Text demo (Gemini only)

```bash
# .env: LLM_PROVIDER=gemini, GEMINI_API_KEY=..., AGENT_MODEL=gemini-flash-lite-latest
pnpm --filter @vaanidesk/evals run -- --filter hinglish-basic-booking --no-db
```

This runs a scripted caller against the real model with the production system prompt, tools, and
guardrails, then prints the verdict, the LLM cost, and (with the judge) a 0–1 score. Drop
`--filter` to run the whole suite. Add `--no-judge` to halve the API calls.

Free-tier caveat: Gemini free tier is rate-limited (~15–30 requests/min), so each scripted turn may
wait out a per-minute window — a single scenario can take several minutes, and the full 30-scenario
suite is best run in CI/nightly (see [MEASUREMENTS.md](MEASUREMENTS.md)).

---

## B. Live phone call (full pipeline)

### Prerequisites (all required)

| Purpose        | Env var(s)                                  | Where                         |
| -------------- | ------------------------------------------- | ----------------------------- |
| LLM (brain)    | `GEMINI_API_KEY` (or `ANTHROPIC_API_KEY`)   | aistudio.google.com/apikey    |
| STT            | `DEEPGRAM_API_KEY`                          | deepgram.com                  |
| TTS            | `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID` | elevenlabs.io                 |
| Telephony      | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`   | twilio.com (+ a phone number) |
| Public URL     | an https/wss tunnel (e.g. ngrok)            | —                             |

> Two gotchas found during validation:
> - **`ELEVENLABS_VOICE_ID` must be a voice your plan allows.** Premium/cloned voices return
>   `payment_required` on the free tier — the WS just closes. Use a default voice id (e.g.
>   `CwhRBWXzGAHq8TQ4Fs17`) on free, or upgrade.
> - **A Twilio Trial account** can only call *verified* caller numbers and prepends a trial greeting.
>   Upgrade for a clean demo, and provision a **voice-capable** number.

### Steps

```bash
pnpm install
cp .env.example .env            # fill in all keys above
docker compose up -d            # Postgres + Redis
pnpm db:migrate
pnpm db:seed                    # demo salon + services + hours
pnpm dev                        # api :4000, voice-gateway :4100, web :3000, workers
```

Expose the api and gateway publicly and wire Twilio:

```bash
ngrok http 4000                 # → https://<id>.ngrok.app
```

- Set `PUBLIC_API_URL=https://<id>.ngrok.app` and
  `GATEWAY_STREAM_URL=wss://<gateway-tunnel>/stream` in `.env`, restart `pnpm dev`.
- In the Twilio number's Voice config, point "A call comes in" webhook at
  `https://<id>.ngrok.app/webhooks/telephony/voice` (POST).

Now **call the Twilio number**. Watch the call live at `http://localhost:3000` (dashboard →
Live calls) while you talk to the agent.

### Suggested demo script (what to say)

1. "Hi, do you have a slot for a haircut tomorrow evening?" → agent checks availability (tool call)
   and offers real slots from the DB.
2. "5:30 works. Name's Priya." → agent books it (create_booking) and confirms only after the tool
   succeeds.
3. "Actually what's the price for a haircut?" → agent answers from the DB, never invented.
4. Optional: switch to Hindi/Hinglish mid-call to show language handling.
5. "Can I talk to a person?" → agent offers transfer to the owner.

Show, alongside the call: the dashboard's live transcript, then the created booking under Bookings,
and (if configured) the WhatsApp confirmation the worker sends.

### Recording the video

Screen-record the dashboard live-calls view during the call, with the call on speaker (or use
Twilio's call recording). Keep it under ~2 minutes: dial → availability → booking → confirmation.

import { config } from "dotenv";
import { createDeepgramStream } from "./src/providers/stt.js";
import { createElevenLabsSession } from "./src/providers/tts.js";

config({ path: "../../.env" });
config();

const log = { error: () => {}, warn: () => {}, info: () => {}, child: () => log } as never;

const DG_KEY = process.env.DEEPGRAM_API_KEY ?? "";
const EL_KEY = process.env.ELEVENLABS_API_KEY ?? "";
const EL_VOICE = process.env.ELEVENLABS_VOICE_ID ?? "";
const EL_MODEL = process.env.ELEVENLABS_MODEL ?? "eleven_flash_v2_5";
const DG_MODEL = process.env.DEEPGRAM_MODEL ?? "nova-3";
const TW_SID = process.env.TWILIO_ACCOUNT_SID ?? "";
const TW_TOKEN = process.env.TWILIO_AUTH_TOKEN ?? "";
const CALLER_LINE = "Hello, do you have a slot for a haircut tomorrow evening?";

const mask = (v: string) => (v ? `${v.slice(0, 4)}…${v.slice(-2)} (${v.length})` : "(EMPTY)");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// 8kHz μ-law silence byte is 0xFF; one 20ms frame = 160 bytes.
const silenceFrame = () => Buffer.alloc(160, 0xff).toString("base64");

async function twilio(): Promise<void> {
  if (!TW_SID || !TW_TOKEN) {
    console.log("  Twilio creds missing — skipping.");
    return;
  }
  const auth = Buffer.from(`${TW_SID}:${TW_TOKEN}`).toString("base64");
  const acc = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TW_SID}.json`, {
    headers: { Authorization: `Basic ${auth}` },
  });
  if (!acc.ok) {
    console.log(`  ✗ Twilio auth FAILED (${acc.status}): ${(await acc.text()).slice(0, 160)}`);
    return;
  }
  const account = (await acc.json()) as { friendly_name?: string; status?: string; type?: string };
  console.log(`  ✓ Twilio auth OK — account "${account.friendly_name}" status=${account.status} type=${account.type}`);

  const nums = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${TW_SID}/IncomingPhoneNumbers.json`,
    { headers: { Authorization: `Basic ${auth}` } },
  );
  if (nums.ok) {
    const body = (await nums.json()) as { incoming_phone_numbers: Array<{ phone_number: string; capabilities: { voice: boolean } }> };
    const list = body.incoming_phone_numbers;
    if (list.length === 0) {
      console.log("  ⚠ NO phone number on this account — a voice-capable number is required to receive a call.");
    } else {
      for (const n of list) console.log(`  ✓ number ${n.phone_number} (voice=${n.capabilities.voice})`);
    }
  }
}

async function synthesize(voiceId: string): Promise<{ ttfbMs: number; totalMs: number; audio: string[]; bytes: number }> {
  const audio: string[] = [];
  const started = performance.now();
  let ttfbMs = 0;
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("TTS timeout (25s)")), 25_000);
    const session = createElevenLabsSession(
      { apiKey: EL_KEY, voiceId, model: EL_MODEL },
      {
        onAudio: (b64) => {
          if (ttfbMs === 0) ttfbMs = performance.now() - started;
          audio.push(b64);
        },
        onComplete: () => {
          clearTimeout(timer);
          const bytes = audio.reduce((n, b) => n + Buffer.from(b, "base64").length, 0);
          resolve({ ttfbMs, totalMs: performance.now() - started, audio, bytes });
        },
        onError: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      },
      log,
    );
    // Give the socket time to open and the model to receive text before flushing.
    session.sendText(CALLER_LINE);
    setTimeout(() => session.endInput(), 600);
  });
}

async function transcribe(audio: string[]): Promise<{ firstFinalMs: number; transcript: string; partials: number }> {
  let transcript = "";
  let firstFinalMs = 0;
  let partials = 0;
  const started = performance.now();
  return await new Promise((resolve, reject) => {
    let done = false;
    const finish = (stream: { close: () => Promise<void> }) => {
      if (done) return;
      done = true;
      void stream.close().then(() => resolve({ firstFinalMs, transcript, partials }));
    };
    const stream = createDeepgramStream(
      { apiKey: DG_KEY, model: DG_MODEL, endpointingMs: 300, utteranceEndMs: 1000 },
      {
        onPartial: (t) => {
          if (t.trim()) partials += 1;
        },
        onFinal: (text) => {
          if (firstFinalMs === 0 && text.trim()) firstFinalMs = performance.now() - started;
          if (text.trim()) transcript += (transcript ? " " : "") + text;
        },
        onUtteranceEnd: () => finish(stream),
        onSpeechStarted: () => {},
        onError: (e) => {
          if (!done) reject(e);
        },
        onClose: () => {},
      },
      log,
    );
    void (async () => {
      // Feed the synthesized μ-law at ~20ms cadence, then trailing silence so
      // Deepgram's endpointing/utterance-end fires — exactly like a real call.
      for (const chunk of audio) {
        stream.sendAudio(chunk);
        await sleep(20);
      }
      for (let i = 0; i < 75; i++) {
        stream.sendAudio(silenceFrame());
        await sleep(20);
      }
      // Fallback if utterance-end never arrives.
      setTimeout(() => finish(stream), 2_000);
    })();
  });
}

async function main(): Promise<void> {
  console.log("=== Voice provider validation (real APIs) ===");
  console.log(`  GEMINI (LLM)  validated separately — see MEASUREMENTS.md`);
  console.log(`  DEEPGRAM_API_KEY   = ${mask(DG_KEY)}  model=${DG_MODEL}`);
  console.log(`  ELEVENLABS_API_KEY = ${mask(EL_KEY)}  model=${EL_MODEL}`);
  console.log(`  ELEVENLABS_VOICE_ID= ${mask(EL_VOICE)}`);
  console.log(`  TWILIO_ACCOUNT_SID = ${mask(TW_SID)}  AUTH_TOKEN=${mask(TW_TOKEN)}\n`);
  if (!EL_KEY || !DG_KEY || !EL_VOICE) {
    console.error("Missing DEEPGRAM_API_KEY / ELEVENLABS_API_KEY / ELEVENLABS_VOICE_ID");
    process.exit(2);
  }

  console.log("[1] Twilio auth + phone-number check…");
  await twilio();

  console.log("\n[2] ElevenLabs TTS (real stream-input WS, ulaw_8000, configured voice)…");
  const tts = await synthesize(EL_VOICE);
  const audioMs = Math.round((tts.bytes / 8000) * 1000); // 8kHz μ-law = 8000 bytes/sec
  console.log(`  ✓ TTS TTFB=${tts.ttfbMs.toFixed(0)}ms · full=${tts.totalMs.toFixed(0)}ms · ${tts.bytes}B (~${audioMs}ms audio)`);

  console.log("\n[3] Deepgram STT on that audio (real streaming WS)…");
  const stt = await transcribe(tts.audio);
  console.log(`  partials=${stt.partials} · first-final=${stt.firstFinalMs.toFixed(0)}ms`);
  console.log(`  transcript: "${stt.transcript}"`);
  const sttOk = stt.transcript.toLowerCase().includes("slot") || stt.transcript.toLowerCase().includes("haircut");
  console.log(sttOk ? "  ✓ STT transcribed the caller line" : "  ✗ STT produced no usable transcript");

  console.log(
    `\nSUMMARY tts_ttfb_ms=${tts.ttfbMs.toFixed(0)} tts_audio_ms=${audioMs} stt_first_final_ms=${stt.firstFinalMs.toFixed(0)} stt_ok=${sttOk}`,
  );
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error("\nVALIDATION FAILED:", error instanceof Error ? error.message : error);
  process.exit(1);
});

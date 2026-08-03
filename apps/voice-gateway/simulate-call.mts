/**
 * Path B: drive the REAL gateway pipeline over Twilio's Media Streams protocol
 * without Twilio. Creates a real call via the api webhook, connects to the
 * gateway /stream, plays a greeting, speaks a synthesized caller line (μ-law via
 * ElevenLabs), and measures voice-to-voice latency + reads the gateway's own
 * per-stage metrics. Everything is real STT (Deepgram) + LLM (Gemini) + TTS
 * (ElevenLabs) on a real DB call record — only Twilio's PSTN transport is absent.
 *
 * Run: pnpm --filter @vaanidesk/voice-gateway exec tsx simulate-call.mts
 */
import { config } from "dotenv";
import { WebSocket } from "ws";
import { createElevenLabsSession } from "./src/providers/tts.js";

config({ path: "../../.env" });
config();

const API = "http://localhost:4000";
const GATEWAY_WS = "ws://localhost:4100/stream";
const SECRET = process.env.INTERNAL_SERVICE_SECRET ?? "";
const EL = {
  apiKey: process.env.ELEVENLABS_API_KEY ?? "",
  voiceId: process.env.ELEVENLABS_VOICE_ID ?? "",
  model: process.env.ELEVENLABS_MODEL ?? "eleven_flash_v2_5",
};
const CALLER_LINE = "Hi, do you have a slot for a haircut tomorrow evening?";
const NUMBER = "+17372212163";
const log = { error: () => {}, warn: () => {}, info: () => {}, child: () => log } as never;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const silence = () => Buffer.alloc(160, 0xff).toString("base64"); // 20ms μ-law silence

function synth(text: string): Promise<string[]> {
  const audio: string[] = [];
  return new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error("caller TTS timeout")), 25_000);
    const s = createElevenLabsSession(
      EL,
      {
        onAudio: (b64) => audio.push(b64),
        onComplete: () => {
          clearTimeout(to);
          resolve(audio);
        },
        onError: (e) => {
          clearTimeout(to);
          reject(e);
        },
      },
      log,
    );
    s.sendText(text);
    setTimeout(() => s.endInput(), 600);
  });
}

async function createCall(): Promise<{ callSid: string; callId: string; businessId: string }> {
  const callSid = `CAsim${Date.now()}`;
  const res = await fetch(`${API}/webhooks/telephony/twilio/voice`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `CallSid=${callSid}&AccountSid=ACsim&From=%2B919820012345&To=${encodeURIComponent(NUMBER)}&CallStatus=ringing&Direction=inbound`,
  });
  const xml = await res.text();
  const callId = /callId" value="([^"]+)"/.exec(xml)?.[1];
  const businessId = /businessId" value="([^"]+)"/.exec(xml)?.[1];
  if (!callId || !businessId) throw new Error(`webhook did not return a stream call: ${xml.slice(0, 160)}`);
  return { callSid, callId, businessId };
}

async function readTurnMetrics(): Promise<Record<string, number>> {
  const res = await fetch("http://localhost:4100/metrics", {
    headers: { authorization: `Bearer ${SECRET}` },
  });
  const body = await res.text();
  const sums: Record<string, number> = {};
  const counts: Record<string, number> = {};
  for (const m of body.matchAll(/vd_turn_latency_seconds_sum\{([^}]*)\}\s+([0-9.eE+-]+)/g)) {
    const stage = /stage="([^"]+)"/.exec(m[1] ?? "")?.[1];
    if (stage) sums[stage] = parseFloat(m[2] ?? "0");
  }
  for (const m of body.matchAll(/vd_turn_latency_seconds_count\{([^}]*)\}\s+([0-9.eE+-]+)/g)) {
    const stage = /stage="([^"]+)"/.exec(m[1] ?? "")?.[1];
    if (stage) counts[stage] = parseFloat(m[2] ?? "0");
  }
  const out: Record<string, number> = {};
  for (const stage of Object.keys(sums)) {
    const c = counts[stage] || 1;
    out[stage] = Math.round((sums[stage] / c) * 1000); // avg per turn → ms
  }
  out["_turns"] = counts["turn_total"] ?? 0;
  return out;
}

async function main(): Promise<void> {
  console.log("=== Path B: simulated Media Streams call through the real gateway ===");
  console.log(`caller line: "${CALLER_LINE}"`);
  console.log("[1] synth caller audio (ElevenLabs μ-law)…");
  const callerAudio = await synth(CALLER_LINE);
  console.log(`    ${callerAudio.length} chunks`);

  console.log("[2] create real call via webhook…");
  const { callSid, callId, businessId } = await createCall();
  console.log(`    callSid=${callSid} callId=${callId}`);

  const ws = new WebSocket(GATEWAY_WS);
  const streamSid = `MZsim${Date.now()}`;
  let lastInboundAudioAt = 0; // last agent audio we received
  let firstAgentReplyAt = 0;
  let callerEndAt = 0;
  let greetingChunks = 0;
  let replyChunks = 0;

  ws.on("message", (raw: Buffer) => {
    let msg: { event: string; media?: { payload: string }; mark?: { name: string } };
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (msg.event === "media") {
      const now = performance.now();
      lastInboundAudioAt = now;
      if (callerEndAt === 0) greetingChunks++;
      else {
        if (firstAgentReplyAt === 0) firstAgentReplyAt = now;
        replyChunks++;
      }
    } else if (msg.event === "mark" && msg.mark) {
      // Twilio echoes marks when playback completes — do the same so the gateway
      // knows the greeting finished and starts listening.
      ws.send(JSON.stringify({ event: "mark", streamSid, mark: { name: msg.mark.name } }));
    }
  });

  ws.on("error", (e) => console.error("ws error:", e.message));

  await new Promise<void>((resolve) => ws.on("open", () => resolve()));
  console.log("[3] WS open → connected + start…");
  ws.send(JSON.stringify({ event: "connected" }));
  ws.send(
    JSON.stringify({
      event: "start",
      streamSid,
      start: {
        streamSid,
        callSid,
        customParameters: { callId, businessId, provider: "twilio" },
        mediaFormat: { encoding: "audio/x-mulaw", sampleRate: 8000, channels: 1 },
      },
    }),
  );

  // Wait for greeting to start then settle (gap of ~1.2s with no new agent audio).
  console.log("[4] waiting for greeting…");
  const startedWait = performance.now();
  while (greetingChunks === 0 && performance.now() - startedWait < 12_000) await sleep(100);
  console.log(`    greeting started (${greetingChunks} chunks so far); waiting for it to finish…`);
  while (performance.now() - lastInboundAudioAt < 1200) await sleep(100);
  console.log(`    greeting done (${greetingChunks} chunks).`);

  // Speak the caller line at 20ms cadence, then trailing silence to end the turn.
  console.log("[5] speaking caller line…");
  for (const chunk of callerAudio) {
    ws.send(JSON.stringify({ event: "media", streamSid, media: { payload: chunk } }));
    await sleep(20);
  }
  callerEndAt = performance.now(); // caller end-of-speech
  for (let i = 0; i < 75; i++) {
    ws.send(JSON.stringify({ event: "media", streamSid, media: { payload: silence() } }));
    await sleep(20);
  }

  console.log("[6] waiting for agent reply…");
  const replyWaitStart = performance.now();
  while (firstAgentReplyAt === 0 && performance.now() - replyWaitStart < 15_000) await sleep(50);
  // let the reply finish (gap)
  while (performance.now() - lastInboundAudioAt < 1500 && performance.now() - replyWaitStart < 20_000)
    await sleep(100);

  const voiceToVoiceMs = firstAgentReplyAt ? Math.round(firstAgentReplyAt - callerEndAt) : -1;

  ws.send(JSON.stringify({ event: "stop", streamSid }));
  await sleep(300);
  ws.close();

  console.log("\n=== RESULTS ===");
  console.log(`greeting audio chunks:      ${greetingChunks}`);
  console.log(`agent reply audio chunks:   ${replyChunks} ${replyChunks > 0 ? "✓ agent spoke" : "✗ no reply"}`);
  console.log(
    `voice-to-voice (caller end → first agent audio): ${voiceToVoiceMs >= 0 ? voiceToVoiceMs + "ms" : "N/A"}`,
  );
  try {
    await sleep(500);
    const stages = await readTurnMetrics();
    console.log("gateway per-stage turn metrics (vd_turn_latency_seconds, ms):");
    for (const [k, v] of Object.entries(stages)) console.log(`   ${k.padEnd(14)} ${v}ms`);
  } catch (e) {
    console.log("could not read /metrics:", e instanceof Error ? e.message : e);
  }
  console.log(`\nSUMMARY v2v_ms=${voiceToVoiceMs} reply_chunks=${replyChunks}`);
  process.exit(0);
}

main().catch((e: unknown) => {
  console.error("simulate-call failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});

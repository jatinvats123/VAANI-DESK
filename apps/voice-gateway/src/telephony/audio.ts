/**
 * G.711 μ-law codec + frame helpers. The live Twilio↔Deepgram↔ElevenLabs path
 * is μ-law passthrough (ADR-0005), so these exist for tests, energy metering,
 * and future providers that need PCM16.
 */

const MULAW_BIAS = 0x84;
const MULAW_CLIP = 32_635;

export function pcm16ToMulaw(sample: number): number {
  let pcm = Math.max(-32_768, Math.min(32_767, Math.round(sample)));
  const sign = pcm < 0 ? 0x80 : 0;
  if (pcm < 0) pcm = -pcm;
  if (pcm > MULAW_CLIP) pcm = MULAW_CLIP;
  pcm += MULAW_BIAS;

  let exponent = 7;
  for (let mask = 0x4000; (pcm & mask) === 0 && exponent > 0; mask >>= 1) {
    exponent--;
  }
  const mantissa = (pcm >> (exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}

export function mulawToPcm16(mulawByte: number): number {
  const inverted = ~mulawByte & 0xff;
  const sign = inverted & 0x80;
  const exponent = (inverted >> 4) & 0x07;
  const mantissa = inverted & 0x0f;
  let sample = ((mantissa << 3) + MULAW_BIAS) << exponent;
  sample -= MULAW_BIAS;
  return sign !== 0 ? -sample : sample;
}

export function encodeMulawBuffer(pcm: Int16Array): Uint8Array {
  const out = new Uint8Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) out[i] = pcm16ToMulaw(pcm[i]!);
  return out;
}

export function decodeMulawBuffer(mulaw: Uint8Array): Int16Array {
  const out = new Int16Array(mulaw.length);
  for (let i = 0; i < mulaw.length; i++) out[i] = mulawToPcm16(mulaw[i]!);
  return out;
}

/** RMS energy of a μ-law frame in PCM16 units — cheap speech-presence signal. */
export function mulawFrameEnergy(mulaw: Uint8Array): number {
  if (mulaw.length === 0) return 0;
  let sumSquares = 0;
  for (let i = 0; i < mulaw.length; i++) {
    const sample = mulawToPcm16(mulaw[i]!);
    sumSquares += sample * sample;
  }
  return Math.sqrt(sumSquares / mulaw.length);
}

/**
 * Split base64 μ-law audio into ~`frameMs` Twilio media payloads (8 bytes/ms
 * at 8kHz). Twilio accepts arbitrary sizes; smaller frames keep the jitter
 * buffer shallow, which keeps barge-in `clear` effective.
 */
export function chunkBase64Mulaw(base64Audio: string, frameMs = 100): string[] {
  const bytes = Buffer.from(base64Audio, "base64");
  const frameBytes = frameMs * 8;
  if (bytes.length <= frameBytes) return bytes.length > 0 ? [bytes.toString("base64")] : [];
  const frames: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += frameBytes) {
    frames.push(bytes.subarray(offset, offset + frameBytes).toString("base64"));
  }
  return frames;
}

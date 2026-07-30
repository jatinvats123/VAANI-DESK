import { describe, expect, it } from "vitest";
import {
  chunkBase64Mulaw,
  decodeMulawBuffer,
  encodeMulawBuffer,
  mulawFrameEnergy,
  mulawToPcm16,
  pcm16ToMulaw,
} from "../src/telephony/audio.js";

describe("μ-law codec", () => {
  it("round-trips representative samples within μ-law quantization error", () => {
    for (const sample of [0, 100, -100, 1000, -1000, 8000, -8000, 30000, -30000]) {
      const decoded = mulawToPcm16(pcm16ToMulaw(sample));
      // μ-law is logarithmic: error grows with amplitude, ~6% worst case.
      const tolerance = Math.max(64, Math.abs(sample) * 0.06);
      expect(Math.abs(decoded - sample)).toBeLessThanOrEqual(tolerance);
    }
  });

  it("clips beyond 16-bit range instead of wrapping", () => {
    expect(mulawToPcm16(pcm16ToMulaw(40_000))).toBeGreaterThan(30_000);
    expect(mulawToPcm16(pcm16ToMulaw(-40_000))).toBeLessThan(-30_000);
  });

  it("buffer helpers preserve length", () => {
    const pcm = new Int16Array([0, 500, -500, 12_000, -12_000]);
    const mulaw = encodeMulawBuffer(pcm);
    expect(mulaw.length).toBe(pcm.length);
    expect(decodeMulawBuffer(mulaw).length).toBe(pcm.length);
  });

  it("silence has near-zero energy, tone has energy", () => {
    const silence = encodeMulawBuffer(new Int16Array(160));
    const tone = encodeMulawBuffer(
      Int16Array.from({ length: 160 }, (_, i) => Math.round(Math.sin(i / 3) * 10_000)),
    );
    expect(mulawFrameEnergy(silence)).toBeLessThan(50);
    expect(mulawFrameEnergy(tone)).toBeGreaterThan(2_000);
  });
});

describe("chunkBase64Mulaw", () => {
  it("splits audio into 100ms (800-byte) frames", () => {
    const audio = Buffer.alloc(2000, 0x7f).toString("base64");
    const frames = chunkBase64Mulaw(audio, 100);
    const sizes = frames.map((f) => Buffer.from(f, "base64").length);
    expect(sizes).toEqual([800, 800, 400]);
  });

  it("passes small payloads through untouched and drops empty ones", () => {
    const small = Buffer.alloc(100, 1).toString("base64");
    expect(chunkBase64Mulaw(small)).toEqual([small]);
    expect(chunkBase64Mulaw("")).toEqual([]);
  });
});

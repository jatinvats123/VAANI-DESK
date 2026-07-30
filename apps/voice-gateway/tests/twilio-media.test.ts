import { describe, expect, it } from "vitest";
import {
  clearMessage,
  extractStreamStart,
  markMessage,
  mediaMessage,
  parseTwilioMessage,
} from "../src/telephony/twilio-media.js";

describe("parseTwilioMessage", () => {
  it("parses a start event with custom parameters", () => {
    const raw = JSON.stringify({
      event: "start",
      sequenceNumber: "1",
      streamSid: "MZxxxx",
      start: {
        accountSid: "ACxxxx",
        streamSid: "MZxxxx",
        callSid: "CAxxxx",
        customParameters: { callId: "call-1", businessId: "biz-1", provider: "twilio" },
        mediaFormat: { encoding: "audio/x-mulaw", sampleRate: 8000, channels: 1 },
      },
    });
    const parsed = parseTwilioMessage(raw);
    expect(parsed.ok).toBe(true);
    if (parsed.ok && parsed.value.event === "start") {
      const start = extractStreamStart(parsed.value);
      expect(start).toEqual({
        streamSid: "MZxxxx",
        providerCallSid: "CAxxxx",
        callId: "call-1",
        businessId: "biz-1",
      });
    }
  });

  it("parses media, mark, dtmf, and stop events", () => {
    const media = parseTwilioMessage(
      JSON.stringify({
        event: "media",
        media: { track: "inbound", chunk: "2", timestamp: "160", payload: "AAAA" },
      }),
    );
    expect(media.ok && media.value.event === "media" && media.value.media.payload).toBe("AAAA");

    const mark = parseTwilioMessage(JSON.stringify({ event: "mark", mark: { name: "utt-1" } }));
    expect(mark.ok && mark.value.event === "mark" && mark.value.mark.name).toBe("utt-1");

    const dtmf = parseTwilioMessage(JSON.stringify({ event: "dtmf", dtmf: { digit: "5" } }));
    expect(dtmf.ok && dtmf.value.event === "dtmf" && dtmf.value.dtmf.digit).toBe("5");

    expect(parseTwilioMessage(JSON.stringify({ event: "stop", stop: {} })).ok).toBe(true);
    expect(parseTwilioMessage(JSON.stringify({ event: "connected", protocol: "Call" })).ok).toBe(
      true,
    );
  });

  it("rejects garbage without throwing", () => {
    expect(parseTwilioMessage("not json").ok).toBe(false);
    expect(parseTwilioMessage(JSON.stringify({ event: "unknown" })).ok).toBe(false);
    expect(parseTwilioMessage(JSON.stringify({ event: "media" })).ok).toBe(false);
  });
});

describe("outbound messages", () => {
  it("serializes media, mark, and clear frames Twilio-shaped", () => {
    expect(JSON.parse(mediaMessage("MZ1", "b64"))).toEqual({
      event: "media",
      streamSid: "MZ1",
      media: { payload: "b64" },
    });
    expect(JSON.parse(markMessage("MZ1", "utt-3"))).toEqual({
      event: "mark",
      streamSid: "MZ1",
      mark: { name: "utt-3" },
    });
    expect(JSON.parse(clearMessage("MZ1"))).toEqual({ event: "clear", streamSid: "MZ1" });
  });
});

import { WebSocket } from "ws";
import type { Logger } from "../logger.js";

/**
 * Streaming STT abstraction + the Deepgram implementation (raw WebSocket —
 * ADR-0005). One SttStream per call, fed μ-law 8kHz frames for the whole
 * duration; events drive the session's turn-taking and barge-in.
 */

export interface SttEvents {
  /** Interim hypothesis — streams to the dashboard, may trigger barge-in. */
  onPartial: (text: string) => void;
  /** Finalized segment of the current utterance. */
  onFinal: (text: string) => void;
  /** The caller finished speaking — end of turn. */
  onUtteranceEnd: () => void;
  /** VAD: caller started speaking (barge-in signal while agent talks). */
  onSpeechStarted: () => void;
  onError: (error: Error) => void;
  onClose: () => void;
}

export interface SttStream {
  sendAudio(mulawBase64: string): void;
  close(): Promise<void>;
}

export interface DeepgramConfig {
  apiKey: string;
  model: string;
  /** Endpoint silence that finalizes a segment (ms). */
  endpointingMs?: number;
  /** Silence gap that ends the utterance/turn (ms). */
  utteranceEndMs?: number;
}

const KEEPALIVE_INTERVAL_MS = 8_000;

export function createDeepgramStream(
  config: DeepgramConfig,
  events: SttEvents,
  log: Logger,
): SttStream {
  const params = new URLSearchParams({
    model: config.model,
    // Hindi/English code-switching — Hinglish callers switch mid-sentence.
    language: "multi",
    encoding: "mulaw",
    sample_rate: "8000",
    channels: "1",
    interim_results: "true",
    smart_format: "true",
    punctuate: "true",
    vad_events: "true",
    endpointing: String(config.endpointingMs ?? 300),
    utterance_end_ms: String(config.utteranceEndMs ?? 1000),
  });

  const ws = new WebSocket(`wss://api.deepgram.com/v1/listen?${params.toString()}`, {
    headers: { Authorization: `Token ${config.apiKey}` },
  });

  let open = false;
  let closed = false;
  const pendingAudio: Buffer[] = [];

  const keepalive = setInterval(() => {
    if (open && !closed) ws.send(JSON.stringify({ type: "KeepAlive" }));
  }, KEEPALIVE_INTERVAL_MS);

  ws.on("open", () => {
    open = true;
    for (const frame of pendingAudio) ws.send(frame);
    pendingAudio.length = 0;
  });

  ws.on("message", (data: Buffer) => {
    let message: DeepgramMessage;
    try {
      message = JSON.parse(data.toString()) as DeepgramMessage;
    } catch {
      return;
    }
    switch (message.type) {
      case "Results": {
        const transcript = message.channel?.alternatives?.[0]?.transcript ?? "";
        if (transcript.trim() === "") return;
        if (message.is_final) events.onFinal(transcript);
        else events.onPartial(transcript);
        // speech_final: Deepgram's endpointer is confident the utterance ended.
        if (message.is_final && message.speech_final) events.onUtteranceEnd();
        return;
      }
      case "UtteranceEnd":
        events.onUtteranceEnd();
        return;
      case "SpeechStarted":
        events.onSpeechStarted();
        return;
      default:
        return;
    }
  });

  ws.on("error", (error: Error) => {
    log.error({ err: error }, "deepgram websocket error");
    events.onError(error);
  });

  ws.on("close", () => {
    closed = true;
    clearInterval(keepalive);
    events.onClose();
  });

  return {
    sendAudio(mulawBase64: string): void {
      if (closed) return;
      const frame = Buffer.from(mulawBase64, "base64");
      if (open) ws.send(frame);
      else if (pendingAudio.length < 500) pendingAudio.push(frame);
    },

    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      clearInterval(keepalive);
      try {
        ws.send(JSON.stringify({ type: "CloseStream" }));
      } catch {
        /* socket already failing — terminate below */
      }
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          ws.terminate();
          resolve();
        }, 2000);
        ws.once("close", () => {
          clearTimeout(timer);
          resolve();
        });
      });
    },
  };
}

interface DeepgramMessage {
  type?: string;
  is_final?: boolean;
  speech_final?: boolean;
  channel?: { alternatives?: Array<{ transcript?: string }> };
}

import { WebSocket } from "ws";
import type { Logger } from "../logger.js";

/**
 * Streaming TTS abstraction + ElevenLabs stream-input implementation.
 * One TtsSession per agent utterance: opened concurrently with the LLM request
 * (its connect cost hides inside LLM TTFT), fed sentence chunks as they stream,
 * emits μ-law 8kHz audio for direct Twilio passthrough. `abort()` is the
 * barge-in path — tears down mid-synthesis.
 */

export interface TtsEvents {
  /** Base64 μ-law 8kHz audio, in synthesis order. */
  onAudio: (mulawBase64: string) => void;
  /** All requested text has been synthesized and delivered. */
  onComplete: () => void;
  onError: (error: Error) => void;
}

export interface TtsSession {
  sendText(chunk: string): void;
  /** No more text; complete once remaining audio flushes. */
  endInput(): void;
  /** Barge-in: stop immediately, drop queued audio. */
  abort(): void;
}

export interface ElevenLabsConfig {
  apiKey: string;
  voiceId: string;
  model: string;
}

export function createElevenLabsSession(
  config: ElevenLabsConfig,
  events: TtsEvents,
  log: Logger,
): TtsSession {
  const params = new URLSearchParams({
    model_id: config.model,
    output_format: "ulaw_8000",
    // auto_mode: synthesize as text arrives without manual flush heuristics.
    auto_mode: "true",
  });
  const ws = new WebSocket(
    `wss://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(
      config.voiceId,
    )}/stream-input?${params.toString()}`,
    { headers: { "xi-api-key": config.apiKey } },
  );

  let open = false;
  let aborted = false;
  let inputEnded = false;
  const pendingText: string[] = [];

  ws.on("open", () => {
    open = true;
    // Initial settings message starts the context.
    ws.send(JSON.stringify({ text: " " }));
    for (const chunk of pendingText) ws.send(JSON.stringify({ text: chunk }));
    pendingText.length = 0;
    if (inputEnded) ws.send(JSON.stringify({ text: "" }));
  });

  ws.on("message", (data: Buffer) => {
    if (aborted) return;
    let message: { audio?: string | null; isFinal?: boolean | null; error?: string };
    try {
      message = JSON.parse(data.toString()) as typeof message;
    } catch {
      return;
    }
    if (message.error) {
      events.onError(new Error(`ElevenLabs: ${message.error}`));
      return;
    }
    if (message.audio) events.onAudio(message.audio);
    if (message.isFinal) {
      events.onComplete();
      ws.close();
    }
  });

  ws.on("error", (error: Error) => {
    if (aborted) return;
    log.error({ err: error }, "elevenlabs websocket error");
    events.onError(error);
  });

  ws.on("close", (code: number) => {
    // Normal close after isFinal already emitted onComplete; an early close
    // without abort means synthesis died — surface it once.
    if (!aborted && code !== 1000 && !inputEnded) {
      events.onError(new Error(`ElevenLabs socket closed early (${code})`));
    }
  });

  return {
    sendText(chunk: string): void {
      if (aborted || inputEnded || chunk === "") return;
      // Trailing space tells the model the token stream continues cleanly.
      const text = chunk.endsWith(" ") ? chunk : `${chunk} `;
      if (open) ws.send(JSON.stringify({ text }));
      else pendingText.push(text);
    },

    endInput(): void {
      if (aborted || inputEnded) return;
      inputEnded = true;
      if (open) ws.send(JSON.stringify({ text: "" }));
    },

    abort(): void {
      if (aborted) return;
      aborted = true;
      ws.terminate();
    },
  };
}

import { randomUUID } from "node:crypto";
import {
  addTokenUsage,
  assembleSystemPrompt,
  buildGreeting,
  computeLlmCostPaise,
  containsAbuse,
  dominantLanguage,
  EMPTY_TOKEN_USAGE,
  findUnauthorizedAmounts,
  initialBudget,
  nextBudgetState,
  parseToolUse,
  pricingForModel,
  type BudgetDecision,
  type CallBudgetState,
  type ParsedToolInput,
} from "@vaanidesk/agent";
import {
  rollupTurnMetrics,
  type CallOutcome,
  type TokenUsage,
  type ToolCallRecord,
  type TurnMetrics,
} from "@vaanidesk/core";
import { maskPhone, parseHM, zonedTimeToUtcMs, type LiveCallEvent } from "@vaanidesk/shared";
import type { CallContextResponse, InternalApiClient, ToolApiResult } from "../api-client.js";
import type { Env } from "../env.js";
import type { Logger } from "../logger.js";
import type { LlmClient, LlmMessage } from "../providers/llm.js";
import type { SttEvents, SttStream } from "../providers/stt.js";
import type { TtsEvents, TtsSession } from "../providers/tts.js";
import { chunkBase64Mulaw } from "../telephony/audio.js";
import { clearMessage, markMessage, mediaMessage } from "../telephony/twilio-media.js";
import { TurnTimer } from "./latency.js";
import { phrase } from "./phrases.js";
import { SentenceChunker } from "./sentence-chunker.js";
import { acceptsCallerAudio, canTransitionCall, isInterruptible, type CallState } from "./state.js";

/** Everything a session needs, injected — no module singletons (testability). */
export interface SessionDeps {
  env: Pick<Env, "SILENCE_TIMEOUT_MS" | "MAX_CALL_DURATION_MS" | "AGENT_MODEL">;
  log: Logger;
  api: InternalApiClient;
  publish: (event: LiveCallEvent) => void;
  createStt: (events: SttEvents) => SttStream;
  createTts: (events: TtsEvents) => TtsSession;
  llm: LlmClient;
  sendToTwilio: (raw: string) => void;
  closeTwilio: () => void;
}

/** Omit that distributes over the event union (plain Omit collapses it). */
type DistributedOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type LiveCallEventBody = DistributedOmit<LiveCallEvent, "callId" | "businessId" | "at">;

const MAX_TOOL_ROUNDS_PER_TURN = 3;
const PARTIAL_PUBLISH_INTERVAL_MS = 300;
const PLAYBACK_MARK_TIMEOUT_MS = 8_000;

interface SpokenUtterance {
  markName: string;
  onPlayed: () => void;
  timeout: NodeJS.Timeout;
}

export class CallSession {
  private state: CallState = "connecting";
  private budget: CallBudgetState = initialBudget();
  private readonly messages: LlmMessage[] = [];
  private readonly systemPrompt: string;
  private readonly language;

  private stt: SttStream | undefined;
  private activeTts: TtsSession | undefined;
  private llmAbort: AbortController | undefined;

  private turnIndex = 0;
  private utteranceCounter = 0;
  private callerUtterance = "";
  private callerTurnStartedAt: Date | undefined;
  private lastPartialPublishAt = 0;
  private readonly callerTexts: string[] = [];
  private readonly agentTurnMetrics: TurnMetrics[] = [];
  private tokenUsage: TokenUsage = EMPTY_TOKEN_USAGE;
  private readonly allowedAmounts = new Set<number>();
  private readonly pendingMarks = new Map<string, SpokenUtterance>();

  private silenceTimer: NodeJS.Timeout | undefined;
  private readonly maxDurationTimer: NodeJS.Timeout;
  private readonly startedAtMs = Date.now();

  private bookingCreated = false;
  private bookingCancelled = false;
  private transferred = false;
  private endReason: "done" | "abandoned" | "abusive" | "failed" | undefined;
  private finalized = false;

  constructor(
    private readonly deps: SessionDeps,
    private readonly context: CallContextResponse,
    private readonly streamSid: string,
  ) {
    this.language = context.business.promptConfig.primaryLanguage;
    this.systemPrompt = assembleSystemPrompt({
      business: {
        name: context.business.name,
        timezone: context.business.timezone,
        hours: context.business.hours,
        promptConfig: context.business.promptConfig,
        policy: {
          minNoticeMin: context.business.policy.minNoticeMin,
          maxAdvanceDays: context.business.policy.maxAdvanceDays,
        },
      },
      services: context.services,
      callerPhone: context.call.fromNumber,
      nowUtcMs: Date.now(),
    });
    for (const service of context.services) this.allowedAmounts.add(service.pricePaise);

    this.maxDurationTimer = setTimeout(() => {
      void this.endCall("done", phrase(this.language, "goodbye"));
    }, deps.env.MAX_CALL_DURATION_MS);
  }

  /** Call once after construction: opens STT, speaks the greeting. */
  async begin(): Promise<void> {
    this.stt = this.deps.createStt(this.sttEvents());
    this.transition("greeting");
    await this.deps.api
      .markAnswered(this.context.call.id, this.context.business.id)
      .catch((error: unknown) => this.log().warn({ err: error }, "markAnswered failed"));
    this.publish({ type: "call.answered" });

    const greeting = buildGreeting({
      name: this.context.business.name,
      timezone: this.context.business.timezone,
      hours: this.context.business.hours,
      promptConfig: this.context.business.promptConfig,
      policy: this.context.business.policy,
    });
    this.messages.push({ role: "assistant", content: greeting });
    await this.speakCanned(greeting, () => {
      if (this.state === "greeting") this.transition("listening");
      this.armSilenceTimer();
    });
    this.recordTurn({ role: "agent", text: greeting });
    this.publishTranscript("agent", greeting, true, this.turnIndex - 1);
  }

  // ── Inbound from Twilio ───────────────────────────────────────────────────

  onMediaPayload(mulawBase64: string): void {
    if (acceptsCallerAudio(this.state)) this.stt?.sendAudio(mulawBase64);
  }

  onMark(name: string): void {
    const pending = this.pendingMarks.get(name);
    if (!pending) return;
    this.pendingMarks.delete(name);
    clearTimeout(pending.timeout);
    pending.onPlayed();
  }

  onDtmf(digit: string): void {
    this.log().debug({ digit }, "dtmf ignored");
  }

  /** Twilio ended the stream: caller hung up, or our transfer TwiML took over. */
  async onStop(): Promise<void> {
    await this.finalize(this.transferred ? "transferred-stop" : "caller-hangup");
  }

  async onSocketClosed(): Promise<void> {
    await this.finalize("socket-closed");
  }

  // ── STT events ────────────────────────────────────────────────────────────

  private sttEvents(): SttEvents {
    return {
      onPartial: (text) => {
        this.handleBargeIn(text);
        this.throttledPartialPublish(text);
      },
      onFinal: (text) => {
        this.handleBargeIn(text);
        this.callerUtterance =
          this.callerUtterance === "" ? text : `${this.callerUtterance} ${text}`;
        this.callerTurnStartedAt ??= new Date();
        this.disarmSilenceTimer();
      },
      onUtteranceEnd: () => {
        void this.onCallerUtteranceEnd();
      },
      onSpeechStarted: () => {
        this.handleBargeIn();
        this.disarmSilenceTimer();
      },
      onError: (error) => {
        this.log().error({ err: error }, "stt stream error");
        void this.transferFallback("speech recognition failed");
      },
      onClose: () => {
        this.log().debug("stt stream closed");
      },
    };
  }

  private handleBargeIn(partialText?: string): void {
    if (!isInterruptible(this.state)) return;
    // Require some substance for text-triggered interrupts; VAD triggers pass undefined.
    if (partialText !== undefined && partialText.trim().length < 2) return;

    this.log().debug("barge-in: caller spoke while agent speaking");
    this.llmAbort?.abort();
    this.activeTts?.abort();
    this.activeTts = undefined;
    this.deps.sendToTwilio(clearMessage(this.streamSid));
    for (const [name, pending] of this.pendingMarks) {
      clearTimeout(pending.timeout);
      this.pendingMarks.delete(name);
    }
    this.transition("listening");
  }

  private async onCallerUtteranceEnd(): Promise<void> {
    const text = this.callerUtterance.trim();
    if (text === "" || this.state !== "listening") return;
    this.callerUtterance = "";
    const startedAt = this.callerTurnStartedAt;
    this.callerTurnStartedAt = undefined;
    this.disarmSilenceTimer();

    this.callerTexts.push(text);
    const callerTurnIndex = this.turnIndex;
    this.recordTurn({
      role: "caller",
      text,
      ...(startedAt !== undefined ? { startedAt: startedAt.toISOString() } : {}),
      endedAt: new Date().toISOString(),
    });
    this.publishTranscript("caller", text, true, callerTurnIndex);
    this.applyBudget(nextBudgetState(this.budget, { type: "caller_spoke" }));

    if (containsAbuse(text)) {
      const decision = nextBudgetState(this.budget, { type: "abuse_detected" });
      this.budget = decision.state;
      if (decision.decision.action === "end") {
        await this.endCall("abusive", phrase(this.language, "goodbye"));
        return;
      }
      await this.speakMiniTurn(phrase(this.language, "abuseWarning"));
      return;
    }

    await this.runAgentTurn(text);
  }

  // ── The agent turn pipeline ───────────────────────────────────────────────

  private async runAgentTurn(callerText: string): Promise<void> {
    this.transition("thinking");
    const timer = new TurnTimer();
    timer.mark("callerSpeechEnd");

    const turnDecision = nextBudgetState(this.budget, { type: "agent_turn" });
    this.budget = turnDecision.state;
    if (turnDecision.decision.action === "transfer") {
      await this.doTransfer(turnDecision.decision.reason);
      return;
    }

    this.messages.push({ role: "user", content: callerText });
    this.llmAbort = new AbortController();
    const signal = this.llmAbort.signal;

    const chunker = new SentenceChunker();
    const agentTurnIndex = this.turnIndex;
    let agentText = "";
    let spokeAnything = false;
    let firstAudioSent = false;
    const toolRecords: ToolCallRecord[] = [];
    let controlAction: ParsedToolInput | undefined;

    const tts = this.deps.createTts({
      onAudio: (audio) => {
        if (signal.aborted) return;
        timer.mark("ttsFirstByte");
        for (const frame of chunkBase64Mulaw(audio)) {
          this.deps.sendToTwilio(mediaMessage(this.streamSid, frame));
        }
        if (!firstAudioSent) {
          firstAudioSent = true;
          timer.mark("firstAudioSent");
          if (this.state === "thinking") this.transition("speaking");
        }
      },
      onComplete: () => {
        this.finishUtterancePlayback(() => {
          if (this.state === "speaking") this.transition("listening");
          this.armSilenceTimer();
          if (controlAction) void this.executeControlAction(controlAction);
        });
      },
      onError: (error) => {
        this.log().error({ err: error }, "tts error mid-turn");
        void this.transferFallback("speech synthesis failed");
      },
    });
    this.activeTts = tts;

    const speakDelta = (delta: string): void => {
      agentText += delta;
      for (const sentence of chunker.push(delta)) {
        spokeAnything = true;
        tts.sendText(sentence);
        this.throttledAgentPartial(agentText, agentTurnIndex);
      }
    };

    try {
      let rounds = 0;
      for (;;) {
        timer.mark("llmRequestSent");
        const result = await this.deps.llm.streamTurn({
          system: this.systemPrompt,
          messages: this.messages,
          signal,
          callbacks: {
            onFirstToken: () => timer.mark("llmFirstToken"),
            onTextDelta: speakDelta,
          },
        });
        timer.markLlmCompleted();
        this.tokenUsage = addTokenUsage(this.tokenUsage, result.usage);
        this.messages.push({ role: "assistant", content: result.assistantContent });

        if (result.stopReason !== "tool_use" || result.toolUses.length === 0) break;

        rounds++;
        if (rounds > MAX_TOOL_ROUNDS_PER_TURN) {
          this.log().warn("tool round budget exceeded");
          await this.doTransfer("tool round budget exceeded");
          return;
        }

        // Filler audio hides tool latency when nothing has been spoken yet.
        const hasDbTool = result.toolUses.some(
          (t) =>
            t.name === "check_availability" ||
            t.name === "create_booking" ||
            t.name === "cancel_booking",
        );
        if (hasDbTool && !spokeAnything) {
          spokeAnything = true;
          tts.sendText(phrase(this.language, "filler"));
        }

        const toolResults: Array<{
          type: "tool_result";
          tool_use_id: string;
          content: string;
          is_error?: boolean;
        }> = [];
        for (const toolUse of result.toolUses) {
          timer.mark("toolStarted");
          const { record, resultContent, isError, control } = await this.executeTool(
            toolUse.id,
            toolUse.name,
            toolUse.input,
            agentTurnIndex,
          );
          timer.mark("toolCompleted");
          toolRecords.push(record);
          if (control) controlAction = control;
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: resultContent,
            ...(isError ? { is_error: true } : {}),
          });
        }
        this.messages.push({ role: "user", content: toolResults });

        // Control tools end the LLM loop; remaining text (if any) still flushes.
        if (controlAction) break;
      }
    } catch (error) {
      if (signal.aborted) return; // barge-in or shutdown — the new turn owns the call now
      this.log().error({ err: error }, "llm turn failed");
      tts.sendText(phrase(this.language, "failureApology"));
      const decision = nextBudgetState(this.budget, { type: "tool_failure" });
      this.budget = decision.state;
      if (decision.decision.action === "transfer") {
        tts.endInput();
        await this.doTransfer("llm failure");
        return;
      }
    }

    if (signal.aborted) return;
    const rest = chunker.flush();
    if (rest) {
      spokeAnything = true;
      tts.sendText(rest);
    }
    tts.endInput();
    if (!spokeAnything) {
      // Nothing to say and no control action — treat as turn end.
      tts.abort();
      this.activeTts = undefined;
      if (this.state !== "listening") this.transition("listening");
      this.armSilenceTimer();
      if (controlAction) void this.executeControlAction(controlAction);
    }

    // Guardrail: every rupee amount spoken must trace to DB/tool facts.
    const unauthorized = findUnauthorizedAmounts(agentText, this.allowedAmounts);
    if (unauthorized.length > 0) {
      this.log().warn(
        { unauthorized, turnIndex: agentTurnIndex },
        "guardrail: agent spoke amounts not present in prompt or tool results",
      );
    }

    const metrics = timer.finish();
    this.agentTurnMetrics.push(metrics);
    this.recordTurn({
      role: "agent",
      text: agentText,
      ...(toolRecords.length > 0 ? { toolCalls: toolRecords } : {}),
      metrics,
    });
    this.publishTranscript("agent", agentText, true, agentTurnIndex + 1);
  }

  // ── Tool execution ────────────────────────────────────────────────────────

  private async executeTool(
    toolUseId: string,
    name: string,
    rawInput: unknown,
    agentTurnIndex: number,
  ): Promise<{
    record: ToolCallRecord;
    resultContent: string;
    isError: boolean;
    control?: ParsedToolInput;
  }> {
    const startedAt = Date.now();
    const parsed = parseToolUse(name, rawInput);
    if (!parsed.ok) {
      this.applyBudget(nextBudgetState(this.budget, { type: "tool_failure" }));
      return {
        record: { name, input: rawInput, ok: false, result: parsed.error },
        resultContent: JSON.stringify({ error: parsed.error }),
        isError: true,
      };
    }

    const tool = parsed.parsed;
    // Control tools change call state — deferred until current speech plays out.
    if (tool.name === "transfer_to_owner" || tool.name === "end_call") {
      return {
        record: { name: tool.name, input: tool.input, ok: true, durationMs: 0 },
        resultContent: JSON.stringify({
          ok: true,
          note: "Wrap up now; action executes after you finish speaking.",
        }),
        isError: false,
        control: tool,
      };
    }

    const apiResult = await this.runDbTool(tool, toolUseId, agentTurnIndex);
    const durationMs = Date.now() - startedAt;
    const ok = apiResult.ok;
    this.applyBudget(nextBudgetState(this.budget, { type: ok ? "tool_success" : "tool_failure" }));
    this.publish({ type: "call.tool", name: tool.name, ok });

    if (ok) this.harvestAllowedAmounts(apiResult.data);
    const record: ToolCallRecord = {
      name: tool.name,
      input: tool.input,
      ok,
      result: ok ? apiResult.data : apiResult.error,
      durationMs,
    };
    return {
      record,
      resultContent: JSON.stringify(ok ? apiResult.data : { error: apiResult.error }),
      isError: !ok,
    };
  }

  private async runDbTool(
    tool: ParsedToolInput,
    toolUseId: string,
    agentTurnIndex: number,
  ): Promise<ToolApiResult> {
    const businessId = this.context.business.id;
    switch (tool.name) {
      case "check_availability":
        return await this.deps.api.checkAvailability({
          businessId,
          serviceId: tool.input.service_id,
          date: tool.input.date,
        });
      case "create_booking": {
        const startsAtUtc = zonedTimeToUtcMs(
          tool.input.date,
          parseHM(tool.input.time),
          this.context.business.timezone,
        );
        const result = await this.deps.api.createBooking({
          businessId,
          callId: this.context.call.id,
          serviceId: tool.input.service_id,
          startsAt: new Date(startsAtUtc).toISOString(),
          customerName: tool.input.customer_name,
          customerPhone: tool.input.customer_phone ?? this.context.call.fromNumber,
          // Stable across LLM retries of the same tool_use, unique across turns.
          idempotencyKey: `${this.context.call.id}:${agentTurnIndex}:${toolUseId}`,
        });
        if (result.ok) this.bookingCreated = true;
        return result;
      }
      case "cancel_booking": {
        const result = await this.deps.api.cancelBooking({
          businessId,
          callId: this.context.call.id,
          customerPhone: this.context.call.fromNumber,
          ...(tool.input.booking_id !== undefined ? { bookingId: tool.input.booking_id } : {}),
          ...(tool.input.reason !== undefined ? { reason: tool.input.reason } : {}),
        });
        if (result.ok) this.bookingCancelled = true;
        return result;
      }
      default:
        return { ok: false, error: { code: "internal_error", message: "unreachable" } };
    }
  }

  private harvestAllowedAmounts(data: unknown): void {
    // Any paise field in a tool result becomes speakable (booking price, etc.).
    const walk = (value: unknown): void => {
      if (Array.isArray(value)) {
        for (const item of value) walk(item);
        return;
      }
      if (typeof value === "object" && value !== null) {
        for (const [key, child] of Object.entries(value)) {
          if (/paise$/i.test(key) && typeof child === "number") this.allowedAmounts.add(child);
          else walk(child);
        }
      }
    };
    walk(data);
  }

  private async executeControlAction(tool: ParsedToolInput): Promise<void> {
    if (tool.name === "transfer_to_owner") {
      await this.doTransfer(tool.input.reason);
    } else if (tool.name === "end_call") {
      const reason = tool.input.reason;
      this.endReason = reason === "abusive" ? "abusive" : "done";
      await this.endCall(this.endReason, undefined);
    }
  }

  // ── Transfer / end / fallbacks ────────────────────────────────────────────

  private async doTransfer(reason: string): Promise<void> {
    if (this.state === "transferring" || this.state === "ending" || this.state === "done") return;
    this.transition("transferring");
    await this.speakCanned(phrase(this.language, "transfer"), () => undefined);
    const result = await this.deps.api.transferCall(
      this.context.call.id,
      this.context.business.id,
      reason,
    );
    if (result.ok) {
      this.transferred = true;
      // Twilio executes the <Dial> TwiML; a `stop` event follows shortly.
      return;
    }
    this.log().warn({ error: result.error }, "transfer failed — ending call");
    this.transition("done");
    await this.finalize("transfer-failed");
    this.deps.closeTwilio();
  }

  private async transferFallback(reason: string): Promise<void> {
    if (this.state === "done" || this.state === "transferring" || this.state === "ending") return;
    this.endReason = "failed";
    await this.doTransfer(reason);
  }

  private async endCall(
    reason: "done" | "abandoned" | "abusive" | "failed",
    goodbye: string | undefined,
  ): Promise<void> {
    if (this.state === "ending" || this.state === "done" || this.state === "transferring") return;
    this.endReason = reason;
    this.transition("ending");
    const text =
      goodbye ?? phrase(this.language, reason === "abandoned" ? "abandonGoodbye" : "goodbye");
    await this.speakCanned(text, () => {
      this.deps.closeTwilio();
    });
  }

  // ── Canned speech (no LLM) ────────────────────────────────────────────────

  /** Speak fixed text; `after` runs when playback completes (or times out). */
  private speakCanned(text: string, after: () => void): Promise<void> {
    return new Promise((resolve) => {
      const tts = this.deps.createTts({
        onAudio: (audio) => {
          for (const frame of chunkBase64Mulaw(audio)) {
            this.deps.sendToTwilio(mediaMessage(this.streamSid, frame));
          }
        },
        onComplete: () => {
          this.finishUtterancePlayback(() => {
            after();
            resolve();
          });
        },
        onError: (error) => {
          this.log().error({ err: error }, "tts error on canned speech");
          after();
          resolve();
        },
      });
      this.activeTts = tts;
      tts.sendText(text);
      tts.endInput();
    });
  }

  private async speakMiniTurn(text: string): Promise<void> {
    this.messages.push({ role: "assistant", content: text });
    this.recordTurn({ role: "agent", text });
    this.publishTranscript("agent", text, true, this.turnIndex - 1);
    await this.speakCanned(text, () => {
      if (this.state === "speaking" || this.state === "thinking") this.transition("listening");
      this.armSilenceTimer();
    });
  }

  /** All audio for the utterance is sent — mark it and wait for Twilio playback. */
  private finishUtterancePlayback(onPlayed: () => void): void {
    const name = `utt-${this.utteranceCounter++}`;
    const timeout = setTimeout(() => {
      if (this.pendingMarks.delete(name)) {
        this.log().warn({ mark: name }, "playback mark timeout — proceeding");
        onPlayed();
      }
    }, PLAYBACK_MARK_TIMEOUT_MS);
    this.pendingMarks.set(name, { markName: name, onPlayed, timeout });
    this.deps.sendToTwilio(markMessage(this.streamSid, name));
  }

  // ── Silence handling ──────────────────────────────────────────────────────

  private armSilenceTimer(): void {
    this.disarmSilenceTimer();
    if (this.state !== "listening") return;
    this.silenceTimer = setTimeout(() => {
      void this.onSilence();
    }, this.deps.env.SILENCE_TIMEOUT_MS);
  }

  private disarmSilenceTimer(): void {
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = undefined;
    }
  }

  private async onSilence(): Promise<void> {
    if (this.state !== "listening") return;
    const decision = nextBudgetState(this.budget, { type: "silence" });
    this.budget = decision.state;
    if (decision.decision.action === "end") {
      await this.endCall("abandoned", undefined);
      return;
    }
    await this.speakMiniTurn(phrase(this.language, "reprompt"));
  }

  // ── Bookkeeping ───────────────────────────────────────────────────────────

  private applyBudget(result: { state: CallBudgetState; decision: BudgetDecision }): void {
    this.budget = result.state;
    if (result.decision.action === "transfer") {
      void this.doTransfer(result.decision.reason);
    }
  }

  private transition(to: CallState): void {
    if (!canTransitionCall(this.state, to)) {
      // Late async events race hangups by design — log, never crash the process.
      this.log().debug({ from: this.state, to }, "ignored illegal state transition");
      return;
    }
    this.log().debug({ from: this.state, to }, "state transition");
    this.state = to;
  }

  /** Fire-and-forget with retry — turn records must never block the audio path. */
  private recordTurn(turn: {
    role: "caller" | "agent";
    text: string;
    toolCalls?: ToolCallRecord[];
    metrics?: TurnMetrics;
    startedAt?: string;
    endedAt?: string;
  }): void {
    const turnIndex = this.turnIndex++;
    const body = {
      businessId: this.context.business.id,
      turnIndex,
      role: turn.role,
      text: turn.text,
      ...(turn.toolCalls !== undefined ? { toolCalls: turn.toolCalls } : {}),
      ...(turn.metrics !== undefined ? { metrics: turn.metrics } : {}),
      ...(turn.startedAt !== undefined ? { startedAt: turn.startedAt } : {}),
      ...(turn.endedAt !== undefined ? { endedAt: turn.endedAt } : {}),
    };
    void this.withRetry(() => this.deps.api.appendTurn(this.context.call.id, body), 3).catch(
      (error: unknown) => this.log().error({ err: error, turnIndex }, "turn record dropped"),
    );
  }

  private async withRetry(fn: () => Promise<void>, attempts: number): Promise<void> {
    for (let attempt = 1; ; attempt++) {
      try {
        await fn();
        return;
      } catch (error) {
        if (attempt >= attempts) throw error;
        await new Promise((r) => setTimeout(r, 400 * 2 ** (attempt - 1)));
      }
    }
  }

  private publish(event: LiveCallEventBody): void {
    this.deps.publish({
      ...event,
      callId: this.context.call.id,
      businessId: this.context.business.id,
      at: Date.now(),
    });
  }

  private publishTranscript(
    role: "caller" | "agent",
    text: string,
    final: boolean,
    turnIndex: number,
  ): void {
    if (text.trim() === "") return;
    this.publish({ type: "call.transcript", role, text, final, turnIndex });
  }

  private throttledPartialPublish(text: string): void {
    const now = Date.now();
    if (now - this.lastPartialPublishAt < PARTIAL_PUBLISH_INTERVAL_MS) return;
    this.lastPartialPublishAt = now;
    this.publish({
      type: "call.transcript",
      role: "caller",
      text,
      final: false,
      turnIndex: this.turnIndex,
    });
  }

  private throttledAgentPartial(text: string, turnIndex: number): void {
    const now = Date.now();
    if (now - this.lastPartialPublishAt < PARTIAL_PUBLISH_INTERVAL_MS) return;
    this.lastPartialPublishAt = now;
    this.publish({
      type: "call.transcript",
      role: "agent",
      text,
      final: false,
      turnIndex: turnIndex + 1,
    });
  }

  // ── Finalization ──────────────────────────────────────────────────────────

  private computeOutcome(): CallOutcome {
    if (this.transferred) return "transferred";
    if (this.bookingCreated) return "booking_created";
    if (this.bookingCancelled) return "booking_cancelled";
    if (this.endReason === "abusive") return "spam";
    if (this.endReason === "abandoned") return "abandoned";
    if (this.endReason === "failed") return "failed";
    return "info_provided";
  }

  private async finalize(cause: string): Promise<void> {
    if (this.finalized) return;
    this.finalized = true;
    this.log().info({ cause }, "finalizing call");

    this.transition("done");
    this.disarmSilenceTimer();
    clearTimeout(this.maxDurationTimer);
    this.llmAbort?.abort();
    this.activeTts?.abort();
    for (const pending of this.pendingMarks.values()) clearTimeout(pending.timeout);
    this.pendingMarks.clear();
    await this.stt?.close().catch(() => undefined);

    const outcome = this.computeOutcome();
    const durationSec = Math.round((Date.now() - this.startedAtMs) / 1000);
    const pricing = pricingForModel(this.deps.env.AGENT_MODEL);
    const llmPaise = pricing ? computeLlmCostPaise(this.tokenUsage, pricing) : undefined;

    // The api's transfer endpoint already completed transferred calls.
    if (!this.transferred) {
      await this.withRetry(
        () =>
          this.deps.api.completeCall(this.context.call.id, {
            businessId: this.context.business.id,
            status: this.endReason === "failed" ? "failed" : "completed",
            endedAt: new Date().toISOString(),
            durationSec,
            outcome,
            language: dominantLanguage(this.callerTexts),
            latencyRollup: rollupTurnMetrics(this.agentTurnMetrics),
            ...(llmPaise !== undefined
              ? { costBreakdown: { llmPaise }, totalCostPaise: llmPaise }
              : {}),
            tokenUsage: this.tokenUsage,
          }),
        3,
      ).catch((error: unknown) =>
        this.log().error({ err: error }, "completeCall failed — webhook will reconcile"),
      );
    }

    this.publish({ type: "call.ended", outcome, durationSec });
    this.log().info(
      {
        outcome,
        durationSec,
        turns: this.turnIndex,
        caller: maskPhone(this.context.call.fromNumber),
      },
      "call finished",
    );
  }

  get isDone(): boolean {
    return this.finalized;
  }

  /** Drain: politely wrap up (used on shutdown when the timeout expires). */
  async forceEnd(): Promise<void> {
    this.endReason ??= "failed";
    await this.finalize("forced-shutdown");
    this.deps.closeTwilio();
  }

  private log(): Logger {
    return this.deps.log.child({ callId: this.context.call.id });
  }
}

/** Session id used for logs before the call context is known. */
export function newConnectionId(): string {
  return randomUUID().slice(0, 8);
}

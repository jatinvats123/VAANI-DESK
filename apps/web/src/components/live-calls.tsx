"use client";

import { useEffect, useRef, useState } from "react";
// Subpath import: the shared root pulls node:crypto (slug helpers), which has
// no place in a browser bundle — live-events is dependency-free.
import { parseLiveCallEvent, type LiveCallEvent } from "@vaanidesk/shared/live-events";
import { Badge, Card, EmptyState } from "./ui";
import { formatDuration } from "@/lib/format";

interface TranscriptLine {
  turnIndex: number;
  role: "caller" | "agent";
  text: string;
  final: boolean;
}

interface LiveCall {
  callId: string;
  fromMasked: string;
  startedAtMs: number;
  status: "live" | "ended";
  outcome?: string;
  transcript: TranscriptLine[];
}

const ENDED_LINGER_MS = 45_000;

/**
 * Live call panel: one WebSocket per viewer, auto-reconnecting with backoff.
 * Transcript partials overwrite in place by turnIndex, so text streams
 * word-by-word exactly as the caller and agent speak.
 */
export function LiveCalls({ businessId }: { businessId: string }) {
  const [calls, setCalls] = useState<Map<string, LiveCall>>(new Map());
  const [connected, setConnected] = useState(false);
  const [, forceTick] = useState(0);

  useEffect(() => {
    let ws: WebSocket | undefined;
    let closed = false;
    let attempt = 0;

    const applyEvent = (event: LiveCallEvent): void => {
      setCalls((prev) => {
        const next = new Map(prev);
        const existing = next.get(event.callId);
        const call: LiveCall = existing ?? {
          callId: event.callId,
          fromMasked: event.type === "call.started" ? event.fromMasked : "Caller",
          startedAtMs: event.at,
          status: "live",
          transcript: [],
        };
        switch (event.type) {
          case "call.started":
            call.fromMasked = event.fromMasked;
            call.startedAtMs = event.at;
            break;
          case "call.transcript": {
            const transcript = [...call.transcript];
            const idx = transcript.findIndex((line) => line.turnIndex === event.turnIndex);
            const line: TranscriptLine = {
              turnIndex: event.turnIndex,
              role: event.role,
              text: event.text,
              final: event.final,
            };
            if (idx >= 0) transcript[idx] = line;
            else transcript.push(line);
            transcript.sort((a, b) => a.turnIndex - b.turnIndex);
            call.transcript = transcript;
            break;
          }
          case "call.ended":
            call.status = "ended";
            if (event.outcome !== undefined) call.outcome = event.outcome;
            setTimeout(() => {
              setCalls((current) => {
                const pruned = new Map(current);
                pruned.delete(event.callId);
                return pruned;
              });
            }, ENDED_LINGER_MS);
            break;
          default:
            break;
        }
        next.set(event.callId, { ...call });
        return next;
      });
    };

    const connect = (): void => {
      if (closed) return;
      const base = process.env.NEXT_PUBLIC_API_WS_URL ?? "ws://localhost:4000";
      ws = new WebSocket(`${base}/ws/live-calls?businessId=${businessId}`);
      ws.onopen = () => {
        attempt = 0;
        setConnected(true);
      };
      ws.onmessage = (message: MessageEvent<string>) => {
        const parsed = parseLiveCallEvent(message.data);
        if (parsed.ok) applyEvent(parsed.value);
      };
      ws.onclose = () => {
        setConnected(false);
        if (closed) return;
        attempt += 1;
        setTimeout(connect, Math.min(1000 * 2 ** attempt, 15_000));
      };
    };

    connect();
    const ticker = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => {
      closed = true;
      clearInterval(ticker);
      ws?.close();
    };
  }, [businessId]);

  const active = [...calls.values()].sort((a, b) => b.startedAtMs - a.startedAtMs);

  return (
    <Card>
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="font-display text-sm font-semibold text-ink">Live calls</h2>
        <span
          className={`size-2 rounded-full ${connected ? "bg-positive" : "bg-ink-faint"}`}
          title={connected ? "Connected" : "Reconnecting…"}
        />
      </div>
      {active.length === 0 ? (
        <EmptyState
          icon="☎"
          title="The line is quiet"
          description="When someone calls your VaaniDesk number, the conversation streams here in real time."
        />
      ) : (
        <div className="divide-y divide-border">
          {active.map((call) => (
            <LiveCallRow key={call.callId} call={call} />
          ))}
        </div>
      )}
    </Card>
  );
}

function LiveCallRow({ call }: { call: LiveCall }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [call.transcript]);

  const elapsedSec = Math.max(0, Math.round((Date.now() - call.startedAtMs) / 1000));
  const lines = call.transcript.slice(-8);

  return (
    <div className="px-4 py-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          {call.status === "live" ? (
            <Badge tone="live">LIVE</Badge>
          ) : (
            <Badge tone="neutral">Ended{call.outcome ? ` · ${call.outcome}` : ""}</Badge>
          )}
          <span className="text-sm font-medium tabular-nums text-ink">{call.fromMasked}</span>
        </div>
        <span className="text-xs tabular-nums text-ink-muted">{formatDuration(elapsedSec)}</span>
      </div>
      <div
        ref={scrollRef}
        className="mt-3 max-h-52 space-y-2 overflow-y-auto rounded-xl bg-surface-2 p-3"
      >
        {lines.length === 0 ? (
          <p className="text-xs text-ink-faint">Connecting audio…</p>
        ) : (
          lines.map((line) => (
            <p key={line.turnIndex} className="text-sm leading-snug">
              <span
                className={`mr-1.5 text-[10px] font-semibold uppercase tracking-wide ${
                  line.role === "agent" ? "text-accent" : "text-info"
                }`}
              >
                {line.role === "agent" ? "Vaani" : "Caller"}
              </span>
              <span className={`text-ink ${!line.final ? "vd-caret" : ""}`}>{line.text}</span>
            </p>
          ))
        )}
      </div>
    </div>
  );
}

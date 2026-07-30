import Link from "next/link";
import { notFound } from "next/navigation";
import { ApiError } from "@/lib/api";
import { Badge, Card, PageHeader } from "@/components/ui";
import { getCall } from "@/lib/data";
import {
  formatDay,
  formatDuration,
  formatPaiseINR,
  formatTime,
  OUTCOME_LABELS,
  OUTCOME_TONES,
} from "@/lib/format";
import { requireBusiness } from "@/lib/session";
import { RecordingPlayer } from "@/components/recording-player";

export const metadata = { title: "Call detail" };

export default async function CallDetailPage({ params }: { params: Promise<{ callId: string }> }) {
  const { business } = await requireBusiness();
  const { callId } = await params;

  let data;
  try {
    data = await getCall(business.id, callId);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
  const { call, turns } = data;
  const outcome = call.status === "in_progress" ? "in_progress" : (call.outcome ?? "info_provided");
  const p50 = call.latencyRollup?.p50;

  return (
    <>
      <Link
        href="/calls"
        className="mb-4 inline-block text-xs font-medium text-ink-muted hover:text-ink"
      >
        ← All calls
      </Link>
      <PageHeader
        title={call.fromNumber}
        subtitle={`${formatDay(call.startedAt)} · ${formatTime(call.startedAt)}${
          call.durationSec != null ? ` · ${formatDuration(call.durationSec)}` : ""
        }`}
        actions={<Badge tone={OUTCOME_TONES[outcome]}>{OUTCOME_LABELS[outcome]}</Badge>}
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetaTile label="Language" value={call.language ?? "—"} />
        <MetaTile
          label="AI cost"
          value={call.totalCostPaise != null ? formatPaiseINR(call.totalCostPaise) : "—"}
        />
        <MetaTile
          label="Response p50"
          value={p50?.turnTotalMs != null ? `${(p50.turnTotalMs / 1000).toFixed(1)}s` : "—"}
        />
        <Card className="p-3.5">
          <p className="text-[10px] font-medium uppercase tracking-wide text-ink-faint">
            Recording
          </p>
          <div className="mt-1">
            {call.hasRecording ? (
              <RecordingPlayer businessId={business.id} callId={call.id} />
            ) : (
              <p className="text-sm font-semibold text-ink">—</p>
            )}
          </div>
        </Card>
      </div>

      <Card>
        <div className="border-b border-border px-4 py-3">
          <h2 className="font-display text-sm font-semibold text-ink">Transcript</h2>
        </div>
        <div className="space-y-4 p-4">
          {turns.length === 0 ? (
            <p className="text-sm text-ink-muted">No transcript recorded for this call.</p>
          ) : (
            turns.map((turn) => (
              <div key={turn.id} className={turn.role === "agent" ? "pr-8" : "pl-8"}>
                <div
                  className={`rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                    turn.role === "agent" ? "bg-accent-soft text-ink" : "bg-surface-2 text-ink"
                  }`}
                >
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
                    {turn.role === "agent" ? "Vaani" : turn.role}
                    {turn.metrics?.turnTotalMs != null
                      ? ` · replied in ${(turn.metrics.turnTotalMs / 1000).toFixed(1)}s`
                      : ""}
                  </p>
                  {turn.text}
                  {turn.toolCalls?.map((tool, i) => (
                    <p
                      key={i}
                      className={`mt-1.5 inline-block rounded-lg px-2 py-0.5 font-mono text-[11px] ${
                        tool.ok
                          ? "bg-positive-soft text-positive"
                          : "bg-negative-soft text-negative"
                      }`}
                    >
                      ⚙ {tool.name}
                      {tool.durationMs != null ? ` · ${tool.durationMs}ms` : ""}
                    </p>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </Card>
    </>
  );
}

function MetaTile({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-3.5">
      <p className="text-[10px] font-medium uppercase tracking-wide text-ink-faint">{label}</p>
      <p className="mt-1 text-sm font-semibold text-ink">{value}</p>
    </Card>
  );
}

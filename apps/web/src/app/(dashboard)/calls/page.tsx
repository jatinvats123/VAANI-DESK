import { Suspense } from "react";
import Link from "next/link";
import { Badge, Card, EmptyState, PageHeader, SkeletonRows } from "@/components/ui";
import { listCalls } from "@/lib/data";
import {
  formatDay,
  formatDuration,
  formatRelative,
  OUTCOME_LABELS,
  OUTCOME_TONES,
} from "@/lib/format";
import { requireBusiness } from "@/lib/session";

export const metadata = { title: "Calls" };

export default async function CallsPage({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string }>;
}) {
  const { business } = await requireBusiness();
  const { cursor } = await searchParams;

  return (
    <>
      <PageHeader title="Calls" subtitle="Every call Vaani answered, with full transcripts." />
      <Suspense
        key={cursor ?? "first"}
        fallback={
          <Card>
            <SkeletonRows rows={8} />
          </Card>
        }
      >
        <CallList businessId={business.id} cursor={cursor} />
      </Suspense>
    </>
  );
}

async function CallList({ businessId, cursor }: { businessId: string; cursor?: string }) {
  const { calls, nextCursor } = await listCalls(businessId, {
    limit: 25,
    ...(cursor !== undefined ? { cursor } : {}),
  });

  if (calls.length === 0 && !cursor) {
    return (
      <Card>
        <EmptyState
          icon="☎"
          title="No calls yet"
          description="Once your number is live, every answered call lands here with its transcript, outcome, and cost."
        />
      </Card>
    );
  }

  return (
    <>
      <Card>
        <ul className="divide-y divide-border">
          {calls.map((call) => {
            const outcome =
              call.status === "in_progress" ? "in_progress" : (call.outcome ?? "info_provided");
            return (
              <li key={call.id}>
                <Link
                  href={`/calls/${call.id}`}
                  className="flex items-center gap-3 px-4 py-3 transition hover:bg-surface-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium tabular-nums text-ink">{call.fromNumber}</p>
                    <p className="mt-0.5 text-xs text-ink-muted">
                      {formatDay(call.startedAt)} · {formatRelative(call.startedAt)}
                      {call.durationSec != null ? ` · ${formatDuration(call.durationSec)}` : ""}
                      {call.language ? ` · ${call.language}` : ""}
                    </p>
                  </div>
                  <Badge tone={OUTCOME_TONES[outcome]}>{OUTCOME_LABELS[outcome]}</Badge>
                </Link>
              </li>
            );
          })}
        </ul>
      </Card>
      {nextCursor ? (
        <div className="mt-4 flex justify-center">
          <Link
            href={`/calls?cursor=${encodeURIComponent(nextCursor)}`}
            className="rounded-xl border border-border bg-surface px-4 py-2 text-sm font-medium text-ink-muted transition hover:text-ink"
          >
            Older calls →
          </Link>
        </div>
      ) : null}
    </>
  );
}

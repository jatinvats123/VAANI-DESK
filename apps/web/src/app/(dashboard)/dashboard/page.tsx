import { Suspense } from "react";
import Link from "next/link";
import { addDaysISO, utcToLocalDateISO, zonedTimeToUtcMs } from "@vaanidesk/shared";
import { LiveCalls } from "@/components/live-calls";
import { TrendChart } from "@/components/trend-chart";
import {
  Badge,
  Card,
  EmptyState,
  PageHeader,
  Skeleton,
  SkeletonRows,
  StatTile,
} from "@/components/ui";
import { getAnalytics, getBusiness, listBookings } from "@/lib/data";
import { formatPaiseINR, formatTime } from "@/lib/format";
import { requireBusiness } from "@/lib/session";

export const metadata = { title: "Overview" };

export default async function OverviewPage() {
  const { business } = await requireBusiness();

  return (
    <>
      <PageHeader
        title="Overview"
        subtitle="Last 14 days at a glance — live calls stream in as they happen."
      />
      <Suspense fallback={<StatsSkeleton />}>
        <Stats businessId={business.id} />
      </Suspense>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <LiveCalls businessId={business.id} />
        <Suspense
          fallback={
            <Card>
              <SkeletonRows rows={5} />
            </Card>
          }
        >
          <TodayBookings businessId={business.id} />
        </Suspense>
      </div>
    </>
  );
}

async function Stats({ businessId }: { businessId: string }) {
  const analytics = await getAnalytics(businessId, 14);
  const answerRate =
    analytics.calls.total > 0
      ? `${Math.round((analytics.calls.answered / analytics.calls.total) * 100)}% answered`
      : "No calls yet";
  const dayLabel = (date: string) =>
    new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short" }).format(new Date(date));

  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Calls handled" value={String(analytics.calls.total)} hint={answerRate} />
        <StatTile
          label="Bookings created"
          value={String(analytics.bookings.created)}
          hint={`${analytics.bookings.voiceCreated} by Vaani on calls`}
        />
        <StatTile
          label="Revenue saved"
          value={formatPaiseINR(analytics.bookings.voiceRevenuePaise)}
          hint="From voice bookings"
          accent
        />
        <StatTile
          label="AI cost"
          value={formatPaiseINR(analytics.calls.totalCostPaise)}
          hint="Across all calls"
        />
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Card className="p-4">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-faint">
            Calls per day
          </p>
          <TrendChart
            title="Calls per day, last 14 days"
            points={analytics.daily.map((d) => ({ label: dayLabel(d.date), value: d.calls }))}
          />
        </Card>
        <Card className="p-4">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-faint">
            Voice revenue per day
          </p>
          <TrendChart
            title="Voice booking revenue per day, last 14 days"
            points={analytics.daily.map((d) => ({
              label: dayLabel(d.date),
              value: d.voiceRevenuePaise,
              display: formatPaiseINR(d.voiceRevenuePaise),
            }))}
          />
        </Card>
      </div>
    </>
  );
}

async function TodayBookings({ businessId }: { businessId: string }) {
  const { business } = await getBusiness(businessId);
  const today = utcToLocalDateISO(Date.now(), business.timezone);
  const fromIso = new Date(zonedTimeToUtcMs(today, 0, business.timezone)).toISOString();
  const toIso = new Date(
    zonedTimeToUtcMs(addDaysISO(today, 1), 0, business.timezone),
  ).toISOString();
  const { bookings } = await listBookings(businessId, fromIso, toIso);
  const upcoming = bookings.filter((b) => b.status === "confirmed" || b.status === "pending");

  return (
    <Card>
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="font-display text-sm font-semibold text-ink">Today&apos;s bookings</h2>
        <Link href="/bookings" className="text-xs font-medium text-accent hover:text-accent-strong">
          View all →
        </Link>
      </div>
      {upcoming.length === 0 ? (
        <EmptyState
          icon="▤"
          title="Nothing booked today"
          description="Bookings made on calls or from the dashboard will appear here."
        />
      ) : (
        <ul className="divide-y divide-border">
          {upcoming.map((booking) => (
            <li key={booking.id} className="flex items-center gap-3 px-4 py-3">
              <div className="w-16 shrink-0 text-sm font-semibold tabular-nums text-ink">
                {formatTime(booking.startsAt, business.timezone)}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink">{booking.customerName}</p>
                <p className="truncate text-xs text-ink-muted">
                  {booking.service?.name ?? "Service"} · {formatPaiseINR(booking.pricePaise)}
                </p>
              </div>
              {booking.source === "voice" ? <Badge tone="positive">via Vaani</Badge> : null}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function StatsSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {Array.from({ length: 4 }, (_, i) => (
        <Card key={i} className="p-4">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="mt-2 h-7 w-16" />
          <Skeleton className="mt-2 h-3 w-24" />
        </Card>
      ))}
    </div>
  );
}

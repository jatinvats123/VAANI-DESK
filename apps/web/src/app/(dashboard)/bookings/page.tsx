import { Suspense } from "react";
import Link from "next/link";
import { addDaysISO, isValidISODate, utcToLocalDateISO, zonedTimeToUtcMs } from "@vaanidesk/shared";
import { BookingCreateForm } from "@/components/booking-create-form";
import { Badge, Card, EmptyState, PageHeader, SkeletonRows } from "@/components/ui";
import { getBusiness, listBookings, listServices } from "@/lib/data";
import { formatDay, formatPaiseINR, formatTime } from "@/lib/format";
import { requireBusiness } from "@/lib/session";
import { cancelBookingAction, setBookingStatusAction } from "./actions";

export const metadata = { title: "Bookings" };

export default async function BookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const { business } = await requireBusiness();
  const { business: full } = await getBusiness(business.id);
  const today = utcToLocalDateISO(Date.now(), full.timezone);
  const { date: rawDate } = await searchParams;
  const date = rawDate && isValidISODate(rawDate) ? rawDate : today;
  const { services } = await listServices(business.id);

  return (
    <>
      <PageHeader
        title="Bookings"
        subtitle="Everything on the calendar — voice, dashboard, and WhatsApp."
        actions={
          <BookingCreateForm
            businessId={business.id}
            timezone={full.timezone}
            services={services}
            defaultDate={date}
          />
        }
      />

      <div className="mb-4 flex items-center gap-2">
        <DayLink date={addDaysISO(date, -1)} label="←" />
        <div className="rounded-xl border border-border bg-surface px-4 py-2 text-sm font-semibold text-ink">
          {date === today
            ? "Today"
            : formatDay(
                new Date(zonedTimeToUtcMs(date, 720, full.timezone)).toISOString(),
                full.timezone,
              )}
        </div>
        <DayLink date={addDaysISO(date, 1)} label="→" />
        {date !== today ? <DayLink date={today} label="Back to today" /> : null}
      </div>

      <Suspense
        key={date}
        fallback={
          <Card>
            <SkeletonRows rows={6} />
          </Card>
        }
      >
        <DayBookings businessId={business.id} timezone={full.timezone} date={date} />
      </Suspense>
    </>
  );
}

function DayLink({ date, label }: { date: string; label: string }) {
  return (
    <Link
      href={`/bookings?date=${date}`}
      className="rounded-xl border border-border bg-surface px-3 py-2 text-sm text-ink-muted transition hover:text-ink"
    >
      {label}
    </Link>
  );
}

async function DayBookings({
  businessId,
  timezone,
  date,
}: {
  businessId: string;
  timezone: string;
  date: string;
}) {
  const fromIso = new Date(zonedTimeToUtcMs(date, 0, timezone)).toISOString();
  const toIso = new Date(zonedTimeToUtcMs(addDaysISO(date, 1), 0, timezone)).toISOString();
  const { bookings } = await listBookings(businessId, fromIso, toIso);

  if (bookings.length === 0) {
    return (
      <Card>
        <EmptyState
          icon="▤"
          title="No bookings this day"
          description="Slots Vaani books on calls appear here instantly, with a WhatsApp confirmation to the customer."
        />
      </Card>
    );
  }

  return (
    <Card>
      <ul className="divide-y divide-border">
        {bookings.map((booking) => {
          const active = booking.status === "confirmed" || booking.status === "pending";
          return (
            <li key={booking.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="w-16 shrink-0 text-sm font-semibold tabular-nums text-ink">
                {formatTime(booking.startsAt, timezone)}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink">
                  {booking.customerName}
                  <span className="ml-2 text-xs font-normal tabular-nums text-ink-faint">
                    {booking.customerPhone}
                  </span>
                </p>
                <p className="truncate text-xs text-ink-muted">
                  {booking.service?.name ?? "Service"} · {formatPaiseINR(booking.pricePaise)}
                  {booking.source === "voice" ? " · booked by Vaani" : ""}
                </p>
              </div>
              <BookingStatusBadge status={booking.status} />
              {active ? (
                <div className="flex items-center gap-1.5">
                  <form
                    action={setBookingStatusAction.bind(null, businessId, booking.id, "completed")}
                  >
                    <ActionButton label="Done" />
                  </form>
                  <form
                    action={setBookingStatusAction.bind(null, businessId, booking.id, "no_show")}
                  >
                    <ActionButton label="No-show" />
                  </form>
                  <form action={cancelBookingAction.bind(null, businessId, booking.id)}>
                    <ActionButton label="Cancel" danger />
                  </form>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function BookingStatusBadge({ status }: { status: string }) {
  switch (status) {
    case "confirmed":
      return <Badge tone="positive">Confirmed</Badge>;
    case "pending":
      return <Badge tone="info">Pending</Badge>;
    case "completed":
      return <Badge tone="neutral">Completed</Badge>;
    case "no_show":
      return <Badge tone="negative">No-show</Badge>;
    default:
      return <Badge tone="neutral">Cancelled</Badge>;
  }
}

function ActionButton({ label, danger = false }: { label: string; danger?: boolean }) {
  return (
    <button
      type="submit"
      className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition ${
        danger
          ? "border-negative/30 text-negative hover:bg-negative-soft"
          : "border-border text-ink-muted hover:bg-surface-2 hover:text-ink"
      }`}
    >
      {label}
    </button>
  );
}

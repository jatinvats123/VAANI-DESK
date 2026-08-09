import {
  AppError,
  buildPage,
  decodeCursor,
  err,
  ok,
  type Page,
  type Result,
} from "@vaanidesk/shared";
import {
  assertBookingTransition,
  CAPACITY_HOLDING_STATUSES,
  type AuditActorType,
  type BookingSource,
  type BookingStatus,
  type BusyPeriod,
  type CallOutcome,
  type CallStatus,
  type TelephonyProvider,
} from "@vaanidesk/core";
import { and, asc, desc, eq, gt, gte, inArray, lt, or, sql } from "drizzle-orm";
import type { DbExecutor } from "../client.js";
import {
  auditLog,
  bookings,
  businesses,
  calls,
  callTurns,
  resources,
  services,
} from "../schema/index.js";
import type {
  Booking,
  Business,
  Call,
  CallTurn,
  NewBooking,
  NewCall,
  NewCallTurn,
  NewResource,
  NewService,
  Resource,
  Service,
} from "../types.js";

export interface CreateBookingInput {
  serviceId: string;
  resourceId?: string | null;
  callId?: string | null;
  customerName: string;
  customerPhone: string;
  startsAt: Date;
  endsAt: Date;
  status?: Extract<BookingStatus, "pending" | "confirmed">;
  source: BookingSource;
  pricePaise: number;
  notes?: string | null;
  idempotencyKey: string;
}

export interface StartCallInput {
  provider: TelephonyProvider;
  providerCallId: string;
  direction?: "inbound" | "outbound";
  fromNumber: string;
  toNumber: string;
  startedAt?: Date;
}

export interface CompleteCallInput {
  status: Extract<CallStatus, "completed" | "failed">;
  endedAt: Date;
  durationSec?: number;
  outcome?: CallOutcome;
  language?: string;
  recordingKey?: string;
  transferredTo?: string;
  costBreakdown?: Call["costBreakdown"];
  totalCostPaise?: number;
  latencyRollup?: Call["latencyRollup"];
  tokenUsage?: Call["tokenUsage"];
}

export interface AuditInput {
  actorType: AuditActorType;
  actorId?: string;
  action: string;
  entityType?: string;
  entityId?: string;
  metadata?: unknown;
}

async function getBookingById(
  db: DbExecutor,
  businessId: string,
  id: string,
): Promise<Booking | undefined> {
  const rows = await db
    .select()
    .from(bookings)
    .where(and(eq(bookings.id, id), eq(bookings.businessId, businessId)))
    .limit(1);
  return rows[0];
}

/**
 * Tenant-scoped repositories. `businessId` is closed over at construction and
 * appended to every query — callers cannot express a cross-tenant read or
 * write through this API. See ADR-0003.
 */
function createTenantRepos(db: DbExecutor, businessId: string) {
  return {
    businessId,

    /**
     * Serialize booking writes for this business for the duration of the
     * current transaction (pg advisory xact lock — released on commit or
     * rollback automatically). Call as the first statement inside
     * `transaction()` before the availability re-check; without it, two
     * concurrent creates could both pass the check and double-book. Per-tenant
     * scope keeps one busy salon from queueing behind another.
     */
    async acquireBookingWriteLock(): Promise<void> {
      await db.execute(sql`select pg_advisory_xact_lock(hashtext(${businessId}))`);
    },

    business: {
      async get(): Promise<Business> {
        const rows = await db
          .select()
          .from(businesses)
          .where(eq(businesses.id, businessId))
          .limit(1);
        const business = rows[0];
        if (!business) throw AppError.notFound("Business", businessId);
        return business;
      },

      async update(
        patch: Partial<
          Pick<
            Business,
            | "name"
            | "phoneNumber"
            | "ownerPhone"
            | "notificationPhone"
            | "timezone"
            | "hours"
            | "promptConfig"
            | "slotGranularityMin"
            | "bookingBufferMin"
            | "minNoticeMin"
            | "maxAdvanceDays"
            | "onboardedAt"
          >
        >,
      ): Promise<Business> {
        const rows = await db
          .update(businesses)
          .set(patch)
          .where(eq(businesses.id, businessId))
          .returning();
        const business = rows[0];
        if (!business) throw AppError.notFound("Business", businessId);
        return business;
      },
    },

    services: {
      async list(opts: { includeInactive?: boolean } = {}): Promise<Service[]> {
        const where = opts.includeInactive
          ? eq(services.businessId, businessId)
          : and(eq(services.businessId, businessId), eq(services.active, true));
        return await db
          .select()
          .from(services)
          .where(where)
          .orderBy(asc(services.sortOrder), asc(services.createdAt));
      },

      async getById(id: string): Promise<Service | undefined> {
        const rows = await db
          .select()
          .from(services)
          .where(and(eq(services.id, id), eq(services.businessId, businessId)))
          .limit(1);
        return rows[0];
      },

      async create(input: Omit<NewService, "businessId" | "id">): Promise<Service> {
        const rows = await db
          .insert(services)
          .values({ ...input, businessId })
          .returning();
        const service = rows[0];
        if (!service) throw AppError.internal("Service insert returned no row");
        return service;
      },

      async update(
        id: string,
        patch: Partial<Omit<NewService, "businessId" | "id">>,
      ): Promise<Service | undefined> {
        const rows = await db
          .update(services)
          .set(patch)
          .where(and(eq(services.id, id), eq(services.businessId, businessId)))
          .returning();
        return rows[0];
      },
    },

    resources: {
      async list(opts: { includeInactive?: boolean } = {}): Promise<Resource[]> {
        const where = opts.includeInactive
          ? eq(resources.businessId, businessId)
          : and(eq(resources.businessId, businessId), eq(resources.active, true));
        return await db.select().from(resources).where(where).orderBy(asc(resources.createdAt));
      },

      async create(input: Omit<NewResource, "businessId" | "id">): Promise<Resource> {
        const rows = await db
          .insert(resources)
          .values({ ...input, businessId })
          .returning();
        const resource = rows[0];
        if (!resource) throw AppError.internal("Resource insert returned no row");
        return resource;
      },

      async update(
        id: string,
        patch: Partial<Omit<NewResource, "businessId" | "id">>,
      ): Promise<Resource | undefined> {
        const rows = await db
          .update(resources)
          .set(patch)
          .where(and(eq(resources.id, id), eq(resources.businessId, businessId)))
          .returning();
        return rows[0];
      },

      /** Pool size for the availability engine's capacity model. */
      async activeCount(): Promise<number> {
        const rows = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(resources)
          .where(and(eq(resources.businessId, businessId), eq(resources.active, true)));
        return rows[0]?.count ?? 0;
      },
    },

    bookings: {
      getById: (id: string) => getBookingById(db, businessId, id),

      /**
       * Idempotent insert keyed on (business_id, idempotency_key): the same key
       * always returns the same booking with `created: false` — retries from
       * the agent or network can never double-book.
       */
      async createIdempotent(
        input: CreateBookingInput,
      ): Promise<{ booking: Booking; created: boolean }> {
        const values: NewBooking = { ...input, businessId };
        const inserted = await db
          .insert(bookings)
          .values(values)
          .onConflictDoNothing({ target: [bookings.businessId, bookings.idempotencyKey] })
          .returning();
        const created = inserted[0];
        if (created) return { booking: created, created: true };

        const existing = await db
          .select()
          .from(bookings)
          .where(
            and(
              eq(bookings.businessId, businessId),
              eq(bookings.idempotencyKey, input.idempotencyKey),
            ),
          )
          .limit(1);
        const booking = existing[0];
        if (!booking) throw AppError.internal("Booking vanished between insert and select");
        return { booking, created: false };
      },

      /** Existing booking for an idempotency key, if any — lets callers short-
       * circuit a replay before running availability checks (which would other-
       * wise see the slot held by the first, identical booking and reject it). */
      async findByIdempotencyKey(idempotencyKey: string): Promise<Booking | undefined> {
        const rows = await db
          .select()
          .from(bookings)
          .where(and(eq(bookings.businessId, businessId), eq(bookings.idempotencyKey, idempotencyKey)))
          .limit(1);
        return rows[0];
      },

      /** Bookings overlapping [fromUtc, toUtc) that hold capacity — engine input. */
      async listCapacityHolding(fromUtc: Date, toUtc: Date): Promise<BusyPeriod[]> {
        const rows = await db
          .select({ startsAt: bookings.startsAt, endsAt: bookings.endsAt })
          .from(bookings)
          .where(
            and(
              eq(bookings.businessId, businessId),
              inArray(bookings.status, [...CAPACITY_HOLDING_STATUSES]),
              lt(bookings.startsAt, toUtc),
              gt(bookings.endsAt, fromUtc),
            ),
          );
        return rows.map((row) => ({
          startUtcMs: row.startsAt.getTime(),
          endUtcMs: row.endsAt.getTime(),
        }));
      },

      /** Calendar feed: bookings overlapping the window, with service + resource. */
      async listInRange(fromUtc: Date, toUtc: Date) {
        return await db.query.bookings.findMany({
          where: and(
            eq(bookings.businessId, businessId),
            lt(bookings.startsAt, toUtc),
            gt(bookings.endsAt, fromUtc),
          ),
          with: { service: true, resource: true },
          orderBy: asc(bookings.startsAt),
        });
      },

      async listByCustomerPhone(customerPhone: string, limit = 20): Promise<Booking[]> {
        return await db
          .select()
          .from(bookings)
          .where(
            and(eq(bookings.businessId, businessId), eq(bookings.customerPhone, customerPhone)),
          )
          .orderBy(desc(bookings.startsAt))
          .limit(limit);
      },

      /**
       * Status change guarded by the core state machine — the only write path
       * for `bookings.status`.
       */
      async transitionStatus(
        id: string,
        to: BookingStatus,
        opts: { reason?: string } = {},
      ): Promise<Result<Booking, AppError>> {
        const current = await getBookingById(db, businessId, id);
        if (!current) return err(AppError.notFound("Booking", id));

        const allowed = assertBookingTransition(current.status, to);
        if (!allowed.ok) return err(AppError.conflict(allowed.error));

        const patch: Partial<NewBooking> = { status: to };
        if (to === "cancelled") {
          patch.cancelledAt = new Date();
          patch.cancellationReason = opts.reason ?? null;
        }
        const rows = await db
          .update(bookings)
          .set(patch)
          .where(
            and(
              eq(bookings.id, id),
              eq(bookings.businessId, businessId),
              // Optimistic guard: status unchanged since we validated the transition.
              eq(bookings.status, current.status),
            ),
          )
          .returning();
        const updated = rows[0];
        if (!updated) {
          return err(AppError.conflict("Booking was modified concurrently; retry"));
        }
        return ok(updated);
      },

      /** Reschedule — availability must be re-checked by the caller inside a transaction. */
      async reschedule(id: string, startsAt: Date, endsAt: Date): Promise<Booking | undefined> {
        const rows = await db
          .update(bookings)
          .set({ startsAt, endsAt })
          .where(and(eq(bookings.id, id), eq(bookings.businessId, businessId)))
          .returning();
        return rows[0];
      },
    },

    calls: {
      /** Idempotent call start keyed on (provider, provider_call_id) — webhook retries safe. */
      async startIdempotent(input: StartCallInput): Promise<{ call: Call; created: boolean }> {
        const values: NewCall = { ...input, businessId };
        const inserted = await db
          .insert(calls)
          .values(values)
          .onConflictDoNothing({ target: [calls.provider, calls.providerCallId] })
          .returning();
        const created = inserted[0];
        if (created) return { call: created, created: true };

        const existing = await db
          .select()
          .from(calls)
          .where(
            and(
              eq(calls.businessId, businessId),
              eq(calls.provider, input.provider),
              eq(calls.providerCallId, input.providerCallId),
            ),
          )
          .limit(1);
        const call = existing[0];
        if (!call) throw AppError.internal("Call vanished between insert and select");
        return { call, created: false };
      },

      async getById(id: string): Promise<Call | undefined> {
        const rows = await db
          .select()
          .from(calls)
          .where(and(eq(calls.id, id), eq(calls.businessId, businessId)))
          .limit(1);
        return rows[0];
      },

      async markAnswered(id: string, answeredAt = new Date()): Promise<void> {
        await db
          .update(calls)
          .set({ status: "in_progress", answeredAt })
          .where(and(eq(calls.id, id), eq(calls.businessId, businessId)));
      },

      /** Recording callbacks arrive independently of call completion. */
      async setRecording(id: string, recordingKey: string): Promise<void> {
        await db
          .update(calls)
          .set({ recordingKey })
          .where(and(eq(calls.id, id), eq(calls.businessId, businessId)));
      },

      async complete(id: string, input: CompleteCallInput): Promise<Call | undefined> {
        const rows = await db
          .update(calls)
          .set(input)
          .where(and(eq(calls.id, id), eq(calls.businessId, businessId)))
          .returning();
        return rows[0];
      },

      /** Idempotent per (call_id, turn_index) — gateway retries can't duplicate turns. */
      async appendTurn(
        callId: string,
        turn: Omit<NewCallTurn, "businessId" | "callId" | "id">,
      ): Promise<CallTurn | undefined> {
        const rows = await db
          .insert(callTurns)
          .values({ ...turn, callId, businessId })
          .onConflictDoNothing({ target: [callTurns.callId, callTurns.turnIndex] })
          .returning();
        return rows[0];
      },

      /** Call history, newest first, cursor-paginated. */
      async listPage(opts: { limit: number; cursor?: string }): Promise<Page<Call>> {
        let where = eq(calls.businessId, businessId);
        if (opts.cursor !== undefined) {
          const decoded = decodeCursor(opts.cursor);
          if (!decoded.ok) throw AppError.validation(decoded.error);
          const cursorDate = new Date(decoded.value.k);
          if (Number.isNaN(cursorDate.getTime())) {
            throw AppError.validation("Invalid pagination cursor");
          }
          const afterCursor = or(
            lt(calls.startedAt, cursorDate),
            and(eq(calls.startedAt, cursorDate), lt(calls.id, decoded.value.id)),
          );
          where = and(where, afterCursor) ?? where;
        }
        const rows = await db
          .select()
          .from(calls)
          .where(where)
          .orderBy(desc(calls.startedAt), desc(calls.id))
          .limit(opts.limit + 1);
        return buildPage(rows, opts.limit, (call) => ({
          k: call.startedAt.toISOString(),
          id: call.id,
        }));
      },

      async getWithTurns(id: string) {
        return await db.query.calls.findFirst({
          where: and(eq(calls.id, id), eq(calls.businessId, businessId)),
          with: { turns: { orderBy: asc(callTurns.turnIndex) } },
        });
      },
    },

    audit: {
      async record(input: AuditInput): Promise<void> {
        await db.insert(auditLog).values({ ...input, businessId });
      },
    },

    analytics: {
      /** Dashboard summary tiles for [fromUtc, toUtc): one round trip, three aggregates. */
      async summary(fromUtc: Date, toUtc: Date) {
        const [callRows, outcomeRows, bookingRows] = await Promise.all([
          db
            .select({
              total: sql<number>`count(*)::int`,
              answered: sql<number>`count(*) filter (where ${calls.answeredAt} is not null)::int`,
              totalCostPaise: sql<number>`coalesce(sum(${calls.totalCostPaise}), 0)::int`,
            })
            .from(calls)
            .where(
              and(
                eq(calls.businessId, businessId),
                gte(calls.startedAt, fromUtc),
                lt(calls.startedAt, toUtc),
              ),
            ),
          db
            .select({ outcome: calls.outcome, count: sql<number>`count(*)::int` })
            .from(calls)
            .where(
              and(
                eq(calls.businessId, businessId),
                gte(calls.startedAt, fromUtc),
                lt(calls.startedAt, toUtc),
              ),
            )
            .groupBy(calls.outcome),
          db
            .select({
              created: sql<number>`count(*)::int`,
              voiceCreated: sql<number>`count(*) filter (where ${bookings.source} = 'voice')::int`,
              voiceRevenuePaise: sql<number>`coalesce(sum(${bookings.pricePaise}) filter (where ${bookings.source} = 'voice' and ${bookings.status} in ('pending','confirmed','completed')), 0)::int`,
            })
            .from(bookings)
            .where(
              and(
                eq(bookings.businessId, businessId),
                gte(bookings.createdAt, fromUtc),
                lt(bookings.createdAt, toUtc),
              ),
            ),
        ]);
        const callStats = callRows[0] ?? { total: 0, answered: 0, totalCostPaise: 0 };
        const bookingStats = bookingRows[0] ?? {
          created: 0,
          voiceCreated: 0,
          voiceRevenuePaise: 0,
        };
        const byOutcome: Record<string, number> = {};
        for (const row of outcomeRows) byOutcome[row.outcome ?? "in_progress"] = row.count;
        return { calls: { ...callStats, byOutcome }, bookings: bookingStats };
      },

      /** Per-business-local-day counts for trend charts; gaps filled by the api. */
      async dailySeries(fromUtc: Date, toUtc: Date, timeZone: string) {
        const callDay = sql<string>`to_char(timezone(${timeZone}, ${calls.startedAt}), 'YYYY-MM-DD')`;
        const bookingDay = sql<string>`to_char(timezone(${timeZone}, ${bookings.createdAt}), 'YYYY-MM-DD')`;
        // Group by the select-column ordinal (day = column 1): reusing the sql
        // expression in GROUP BY re-parameterizes it (different $n + column
        // qualification), which Postgres won't match to the SELECT expression.
        const byDay = sql`1`;
        const [callRows, bookingRows] = await Promise.all([
          db
            .select({ day: callDay, count: sql<number>`count(*)::int` })
            .from(calls)
            .where(
              and(
                eq(calls.businessId, businessId),
                gte(calls.startedAt, fromUtc),
                lt(calls.startedAt, toUtc),
              ),
            )
            .groupBy(byDay),
          db
            .select({
              day: bookingDay,
              count: sql<number>`count(*)::int`,
              voiceRevenuePaise: sql<number>`coalesce(sum(${bookings.pricePaise}) filter (where ${bookings.source} = 'voice' and ${bookings.status} in ('pending','confirmed','completed')), 0)::int`,
            })
            .from(bookings)
            .where(
              and(
                eq(bookings.businessId, businessId),
                gte(bookings.createdAt, fromUtc),
                lt(bookings.createdAt, toUtc),
              ),
            )
            .groupBy(byDay),
        ]);
        return { callRows, bookingRows };
      },
    },
  };
}

type TenantRepos = ReturnType<typeof createTenantRepos>;

export function createTenantDal(db: DbExecutor, businessId: string) {
  return {
    ...createTenantRepos(db, businessId),

    /**
     * Run operations atomically against the same tenant scope — used by the
     * booking service for the availability re-check + insert invariant. The
     * callback receives plain repos (no nested transactions).
     */
    async transaction<T>(fn: (tx: TenantRepos) => Promise<T>): Promise<T> {
      return await db.transaction(async (tx) => fn(createTenantRepos(tx, businessId)));
    },
  };
}

export type TenantDal = ReturnType<typeof createTenantDal>;

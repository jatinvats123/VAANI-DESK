import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import {
  createDal,
  createDatabase,
  schema,
  type Business,
  type Dal,
  type Database,
  type TenantDal,
} from "@vaanidesk/db";
import { zonedTimeToUtcMs } from "@vaanidesk/shared";
import {
  createBooking,
  cancelBooking,
  markBookingOutcome,
} from "../../src/modules/bookings/service.js";
import { getDayAvailability } from "../../src/modules/availability/service.js";

/**
 * Booking invariants against a REAL Postgres: the advisory-lock race guard,
 * idempotency, tenant isolation, and state transitions — the things unit tests
 * structurally cannot prove. Database resolution order:
 *   1. TEST_DATABASE_URL (dedicated throwaway DB — it will be migrated into)
 *   2. Testcontainers postgres:16 when Docker is available
 *   3. Otherwise the suite is skipped (CI always runs it).
 */

const MIGRATIONS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../packages/db/drizzle",
);

function dockerAvailable(): boolean {
  try {
    execSync("docker info", { stdio: "ignore", timeout: 15_000 });
    return true;
  } catch {
    return false;
  }
}

const externalUrl = process.env.TEST_DATABASE_URL;
const runnable = externalUrl !== undefined || dockerAvailable();
if (!runnable) {
  console.warn("booking integration suite skipped: no TEST_DATABASE_URL and no Docker");
}

const IST = "Asia/Kolkata";
const OPEN_DAY = [{ open: "10:00", close: "20:00" }];

describe.skipIf(!runnable)("booking service (integration)", () => {
  let container: { stop: () => Promise<unknown> } | undefined;
  let db: Database;
  let closeDb: () => Promise<void>;
  let dal: Dal;

  beforeAll(async () => {
    let url = externalUrl;
    if (!url) {
      const { PostgreSqlContainer } = await import("@testcontainers/postgresql");
      const started = await new PostgreSqlContainer("postgres:16-alpine").start();
      container = started;
      url = started.getConnectionUri();
    }
    const handle = createDatabase(url, { max: 10 });
    db = handle.db;
    closeDb = handle.close;
    dal = createDal(db);
    await migrate(db, { migrationsFolder: MIGRATIONS });
  });

  afterAll(async () => {
    await closeDb?.();
    await container?.stop();
  });

  /** Fresh tenant per test: owner user, open-all-week business, one service. */
  async function makeTenant(): Promise<{
    business: Business;
    tenant: TenantDal;
    serviceId: string;
  }> {
    const suffix = randomUUID().slice(0, 8);
    const [owner] = await db
      .insert(schema.users)
      .values({ email: `owner-${suffix}@test.dev` })
      .returning();
    const created = await dal.system.businesses.createWithOwner({
      name: `Test Salon ${suffix}`,
      slug: `test-salon-${suffix}`,
      ownerUserId: owner!.id,
      timezone: IST,
    });
    const tenant = dal.forBusiness(created.id);
    const business = await tenant.business.update({
      hours: {
        weekly: {
          mon: OPEN_DAY,
          tue: OPEN_DAY,
          wed: OPEN_DAY,
          thu: OPEN_DAY,
          fri: OPEN_DAY,
          sat: OPEN_DAY,
          sun: OPEN_DAY,
        },
        exceptions: [],
      },
    });
    const service = await tenant.services.create({
      name: "Haircut",
      durationMin: 30,
      pricePaise: 40000,
    });
    return { business, tenant, serviceId: service.id };
  }

  /** Tomorrow 17:00 business-local — always inside hours, notice, and window. */
  function slotTomorrow(minutes = 17 * 60): Date {
    const tomorrow = new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 10);
    return new Date(zonedTimeToUtcMs(tomorrow, minutes, IST));
  }

  function request(serviceId: string, startsAt: Date, key: string) {
    return {
      serviceId,
      startsAt,
      customerName: "Rohit",
      customerPhone: "+919876543210",
      source: "dashboard" as const,
      idempotencyKey: key,
    };
  }

  const actor = { type: "user" as const, id: "itest" };

  it("five concurrent creates for one slot yield exactly one booking (advisory lock)", async () => {
    const { business, tenant, serviceId } = await makeTenant();
    const startsAt = slotTomorrow();

    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        createBooking(
          { tenant, business, actor },
          request(serviceId, startsAt, `race-${i}-${business.id}`),
        ),
      ),
    );

    const created = results.filter((r) => r.ok);
    const conflicts = results.filter((r) => !r.ok);
    expect(created).toHaveLength(1);
    expect(conflicts).toHaveLength(4);
    for (const conflict of conflicts) {
      if (!conflict.ok) expect(conflict.error.code).toBe("slot_unavailable");
    }
    const rows = await tenant.bookings.listInRange(
      new Date(startsAt.getTime() - 3600_000),
      new Date(startsAt.getTime() + 3600_000),
    );
    expect(rows).toHaveLength(1);
  });

  it("replaying an idempotency key returns the same booking, created=false", async () => {
    const { business, tenant, serviceId } = await makeTenant();
    const startsAt = slotTomorrow();
    const key = `idem-${business.id}`;

    const first = await createBooking(
      { tenant, business, actor },
      request(serviceId, startsAt, key),
    );
    const second = await createBooking(
      { tenant, business, actor },
      request(serviceId, startsAt, key),
    );
    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(first.value.created).toBe(true);
      expect(second.value.created).toBe(false);
      expect(second.value.booking.id).toBe(first.value.booking.id);
    }
  });

  it("tenant isolation: another business's scoped DAL cannot see or mutate the booking", async () => {
    const a = await makeTenant();
    const b = await makeTenant();
    const result = await createBooking(
      { tenant: a.tenant, business: a.business, actor },
      request(a.serviceId, slotTomorrow(), `iso-${a.business.id}`),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const bookingId = result.value.booking.id;

    expect(await b.tenant.bookings.getById(bookingId)).toBeUndefined();
    const foreignCancel = await b.tenant.bookings.transitionStatus(bookingId, "cancelled");
    expect(foreignCancel.ok).toBe(false);
    // Still confirmed under its own tenant.
    expect((await a.tenant.bookings.getById(bookingId))?.status).toBe("confirmed");
  });

  it("status transitions: cancel once, never twice, never complete-after-cancel", async () => {
    const { business, tenant, serviceId } = await makeTenant();
    const created = await createBooking(
      { tenant, business, actor },
      request(serviceId, slotTomorrow(), `trans-${business.id}`),
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const id = created.value.booking.id;

    const cancelled = await cancelBooking({ tenant, business, actor }, id, "test");
    expect(cancelled.ok).toBe(true);
    const again = await cancelBooking({ tenant, business, actor }, id);
    expect(again.ok).toBe(false);
    const complete = await markBookingOutcome({ tenant, business, actor }, id, "completed");
    expect(complete.ok).toBe(false);
  });

  it("availability excludes the booked slot and frees it again after cancellation", async () => {
    const { business, tenant, serviceId } = await makeTenant();
    const startsAt = slotTomorrow();
    const date = new Date(startsAt.getTime()).toISOString().slice(0, 10);
    const label = "17:00";

    const before = await getDayAvailability({ tenant, business }, { serviceId, date });
    expect(before.ok && before.value.slots.some((s) => s.label === label)).toBe(true);

    const created = await createBooking(
      { tenant, business, actor },
      request(serviceId, startsAt, `avail-${business.id}`),
    );
    expect(created.ok).toBe(true);

    const during = await getDayAvailability({ tenant, business }, { serviceId, date });
    expect(during.ok && during.value.slots.some((s) => s.label === label)).toBe(false);

    if (created.ok) {
      await cancelBooking({ tenant, business, actor }, created.value.booking.id);
    }
    const after = await getDayAvailability({ tenant, business }, { serviceId, date });
    expect(after.ok && after.value.slots.some((s) => s.label === label)).toBe(true);
  });

  it("rejects bookings outside business hours and inside the notice window", async () => {
    const { business, tenant, serviceId } = await makeTenant();

    const lateNight = await createBooking(
      { tenant, business, actor },
      request(serviceId, slotTomorrow(23 * 60), `hours-${business.id}`),
    );
    expect(!lateNight.ok && lateNight.error.code === "slot_unavailable").toBe(true);

    const tooSoon = await createBooking(
      { tenant, business, actor },
      { ...request(serviceId, new Date(Date.now() + 10 * 60_000), `notice-${business.id}`) },
    );
    expect(tooSoon.ok).toBe(false);
  });
});

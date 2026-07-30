import { describe, expect, it } from "vitest";
import { CALLER_PHONE, FIXTURE_TOMORROW, salonFixture, SERVICES } from "../src/fixtures.js";
import { InMemoryToolExecutor } from "../src/tool-executor.js";

const tomorrowAt = (hm: string): string =>
  new Date(Date.parse(`${FIXTURE_TOMORROW}T${hm}:00+05:30`)).toISOString();

function executor(overrides = {}) {
  return new InMemoryToolExecutor(salonFixture(overrides), CALLER_PHONE);
}

const check = (serviceId: string, date: string) =>
  ({ name: "check_availability", input: { service_id: serviceId, date } }) as const;

const create = (time: string, name = "Rohit") =>
  ({
    name: "create_booking",
    input: { service_id: SERVICES.haircut.id, date: FIXTURE_TOMORROW, time, customer_name: name },
  }) as const;

describe("check_availability", () => {
  it("returns engine slots shaped like the api response", () => {
    const result = executor().execute(check(SERVICES.haircut.id, FIXTURE_TOMORROW), "k1");
    expect(result.ok).toBe(true);
    if (result.ok) {
      const data = result.data as {
        open: boolean;
        slots: Array<{ label: string }>;
        totalOpenSlots: number;
      };
      expect(data.open).toBe(true);
      expect(data.totalOpenSlots).toBeGreaterThan(10);
      expect(data.slots.length).toBeLessThanOrEqual(6);
      // 2026-07-18 is a Saturday — the fixture opens Saturdays at 09:00.
      expect(data.slots[0]!.label).toBe("09:00");
    }
  });

  it("rejects past dates, bad dates, unknown services", () => {
    expect(executor().execute(check(SERVICES.haircut.id, "2026-07-10"), "k").ok).toBe(false);
    expect(executor().execute(check(SERVICES.haircut.id, "2026-13-40"), "k").ok).toBe(false);
    expect(
      executor().execute(check("55555555-5555-4555-8555-555555555555", FIXTURE_TOMORROW), "k").ok,
    ).toBe(false);
  });
});

describe("create_booking", () => {
  it("books an open slot and is idempotent per key", () => {
    const ex = executor();
    const first = ex.execute(create("17:00"), "key-1");
    expect(first.ok).toBe(true);
    expect(ex.bookings.filter((b) => b.status === "confirmed")).toHaveLength(1);

    const retry = ex.execute(create("17:00"), "key-1");
    expect(retry.ok).toBe(true);
    expect(ex.bookings.filter((b) => b.status === "confirmed")).toHaveLength(1);
  });

  it("rejects a taken slot with alternatives (capacity 1)", () => {
    const ex = executor({
      activeResources: 1,
      existingBookings: [{ serviceId: SERVICES.haircut.id, startsAtIso: tomorrowAt("17:00") }],
    });
    const result = ex.execute(create("17:00"), "key-2");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("slot_unavailable");
      const details = result.error.details as { alternatives: Array<{ label: string }> };
      expect(details.alternatives.length).toBeGreaterThan(0);
      expect(details.alternatives.map((a) => a.label)).not.toContain("17:00");
    }
  });

  it("enforces business hours and minimum notice", () => {
    // 21:45 is outside 10:00–20:00.
    expect(executor().execute(create("21:45"), "k3").ok).toBe(false);
    // "Today 14:30" is inside the 60min notice window (now = today 14:00 IST).
    const sameDay = executor().execute(
      {
        name: "create_booking",
        input: {
          service_id: SERVICES.haircut.id,
          date: "2026-07-17",
          time: "14:30",
          customer_name: "R",
        },
      },
      "k4",
    );
    expect(sameDay.ok).toBe(false);
  });
});

describe("cancel_booking", () => {
  it("cancels the single upcoming booking for the caller", () => {
    const ex = executor({
      existingBookings: [
        {
          serviceId: SERVICES.haircut.id,
          startsAtIso: tomorrowAt("17:00"),
          customerPhone: CALLER_PHONE,
        },
      ],
    });
    const result = ex.execute({ name: "cancel_booking", input: {} }, "k5");
    expect(result.ok).toBe(true);
    expect(ex.bookings[0]!.status).toBe("cancelled");
  });

  it("asks for disambiguation with multiple bookings, then cancels by id", () => {
    const ex = executor({
      existingBookings: [
        {
          serviceId: SERVICES.haircut.id,
          startsAtIso: tomorrowAt("17:00"),
          customerPhone: CALLER_PHONE,
        },
        {
          serviceId: SERVICES.facial.id,
          startsAtIso: tomorrowAt("12:00"),
          customerPhone: CALLER_PHONE,
        },
      ],
    });
    const ambiguous = ex.execute({ name: "cancel_booking", input: {} }, "k6");
    expect(ambiguous.ok).toBe(false);
    if (!ambiguous.ok) {
      const candidates = (ambiguous.error.details as { candidates: Array<{ bookingId: string }> })
        .candidates;
      expect(candidates).toHaveLength(2);
      const specific = ex.execute(
        { name: "cancel_booking", input: { booking_id: candidates[0]!.bookingId } },
        "k7",
      );
      expect(specific.ok).toBe(true);
    }
  });

  it("reports not_found when the caller has nothing upcoming", () => {
    const result = executor().execute({ name: "cancel_booking", input: {} }, "k8");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("not_found");
  });
});

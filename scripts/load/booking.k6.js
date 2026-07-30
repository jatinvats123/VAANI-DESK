import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Trend } from "k6/metrics";

/**
 * Load profile for the booking hot path — the two internal tool endpoints the
 * voice gateway hits during live calls (service-token auth, no sessions).
 *
 * Run (infra + api up, seeded):
 *   k6 run scripts/load/booking.k6.js \
 *     -e API_URL=http://localhost:4000 \
 *     -e SERVICE_SECRET=<INTERNAL_SERVICE_SECRET> \
 *     -e BUSINESS_ID=<uuid> -e SERVICE_ID=<uuid> -e CALL_ID=<uuid> \
 *     -e DATE=2026-07-25
 *
 * Thresholds mirror the latency budget's tool-call allowance (docs/latency-budget.md):
 * a tool round trip must stay well under the ~45ms DB+hop budget at p95 under load.
 */

const API_URL = __ENV.API_URL || "http://localhost:4000";
const HEADERS = {
  "Content-Type": "application/json",
  Authorization: `Bearer ${__ENV.SERVICE_SECRET}`,
};

const availabilityLatency = new Trend("availability_latency", true);
const bookingLatency = new Trend("booking_latency", true);
const bookingErrors = new Rate("booking_errors");

export const options = {
  scenarios: {
    calls: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "30s", target: 20 }, // busy evening across tenants
        { duration: "1m", target: 20 },
        { duration: "15s", target: 0 },
      ],
    },
  },
  thresholds: {
    availability_latency: ["p(95)<250"],
    booking_latency: ["p(95)<400"],
    booking_errors: ["rate<0.01"],
    http_req_failed: ["rate<0.01"],
  },
};

export default function () {
  // 1. check_availability — every booking call does this at least once.
  const availability = http.post(
    `${API_URL}/v1/internal/tools/check_availability`,
    JSON.stringify({
      businessId: __ENV.BUSINESS_ID,
      serviceId: __ENV.SERVICE_ID,
      date: __ENV.DATE,
    }),
    { headers: HEADERS },
  );
  availabilityLatency.add(availability.timings.duration);
  check(availability, { "availability 200": (r) => r.status === 200 });

  // 2. create_booking — unique idempotency key per iteration; slot conflicts
  //    (409) are correct behavior under contention, not errors.
  const slots = availability.json("slots") || [];
  if (slots.length > 0) {
    const slot = slots[Math.floor(Math.random() * slots.length)];
    const create = http.post(
      `${API_URL}/v1/internal/tools/create_booking`,
      JSON.stringify({
        businessId: __ENV.BUSINESS_ID,
        callId: __ENV.CALL_ID,
        serviceId: __ENV.SERVICE_ID,
        startsAt: slot.startsAt,
        customerName: `Load VU${__VU}`,
        customerPhone: `+9198${String(10000000 + ((__VU * 9973 + __ITER) % 89999999))}`,
        idempotencyKey: `k6-${__VU}-${__ITER}-${Date.now()}`,
      }),
      { headers: HEADERS },
    );
    bookingLatency.add(create.timings.duration);
    const ok = create.status === 200 || create.status === 201 || create.status === 409;
    bookingErrors.add(!ok);
    check(create, { "booking 2xx/409": () => ok });
  }

  sleep(1); // one tool round per second per VU ≈ live-call cadence
}

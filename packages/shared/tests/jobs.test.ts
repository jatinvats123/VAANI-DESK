import { describe, expect, it } from "vitest";
import {
  cancellationJobId,
  computeReminderDelays,
  confirmationJobId,
  jobPayloadSchema,
  reminderJobId,
} from "../src/jobs.js";

const HOUR = 60 * 60 * 1000;

describe("computeReminderDelays", () => {
  it("schedules both reminders for a far-future booking", () => {
    const now = Date.now();
    const delays = computeReminderDelays(now + 48 * HOUR, now);
    expect(delays).toEqual([
      { kind: "24h", delayMs: 24 * HOUR },
      { kind: "2h", delayMs: 46 * HOUR },
    ]);
  });

  it("skips the 24h reminder inside the 24h window", () => {
    const now = Date.now();
    const delays = computeReminderDelays(now + 10 * HOUR, now);
    expect(delays).toEqual([{ kind: "2h", delayMs: 8 * HOUR }]);
  });

  it("skips reminders that would fire almost immediately or in the past", () => {
    const now = Date.now();
    expect(computeReminderDelays(now + 2 * HOUR + 60_000, now)).toEqual([]); // 2h fires in 1min
    expect(computeReminderDelays(now + 30 * 60 * 1000, now)).toEqual([]);
    expect(computeReminderDelays(now - HOUR, now)).toEqual([]);
  });
});

describe("job ids and payloads", () => {
  it("job ids are deterministic and distinct per kind", () => {
    expect(confirmationJobId("b1")).toBe("confirm:b1");
    expect(reminderJobId("b1", "24h")).toBe("remind:b1:24h");
    expect(reminderJobId("b1", "2h")).toBe("remind:b1:2h");
    expect(cancellationJobId("b1")).toBe("cancel:b1");
  });

  it("payload schema validates and rejects", () => {
    const id = "3f0b9a54-3a89-4f4a-9d0a-2f6f6d3d9c11";
    expect(
      jobPayloadSchema.safeParse({
        type: "booking_reminder",
        bookingId: id,
        businessId: id,
        kind: "24h",
      }).success,
    ).toBe(true);
    expect(
      jobPayloadSchema.safeParse({
        type: "booking_reminder",
        bookingId: id,
        businessId: id,
        kind: "1h",
      }).success,
    ).toBe(false);
    expect(jobPayloadSchema.safeParse({ type: "unknown", bookingId: id }).success).toBe(false);
  });
});

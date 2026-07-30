import { describe, expect, it } from "vitest";
import {
  assertBookingTransition,
  canTransitionBooking,
  isTerminalBookingStatus,
} from "../src/booking/transitions.js";
import { BOOKING_STATUSES } from "../src/domain.js";

describe("booking transitions", () => {
  it("allows the happy path", () => {
    expect(canTransitionBooking("pending", "confirmed")).toBe(true);
    expect(canTransitionBooking("confirmed", "completed")).toBe(true);
    expect(canTransitionBooking("confirmed", "no_show")).toBe(true);
    expect(canTransitionBooking("confirmed", "cancelled")).toBe(true);
    expect(canTransitionBooking("pending", "cancelled")).toBe(true);
  });

  it("blocks resurrection of terminal states", () => {
    expect(canTransitionBooking("cancelled", "confirmed")).toBe(false);
    expect(canTransitionBooking("completed", "cancelled")).toBe(false);
    expect(canTransitionBooking("no_show", "confirmed")).toBe(false);
  });

  it("blocks skipping and self-transitions", () => {
    expect(canTransitionBooking("pending", "completed")).toBe(false);
    expect(canTransitionBooking("pending", "no_show")).toBe(false);
    expect(canTransitionBooking("confirmed", "confirmed")).toBe(false);
  });

  it("every status is either terminal or has at least one exit", () => {
    for (const status of BOOKING_STATUSES) {
      const exits = BOOKING_STATUSES.filter((to) => canTransitionBooking(status, to));
      expect(isTerminalBookingStatus(status)).toBe(exits.length === 0);
    }
  });

  it("assertBookingTransition returns a readable error", () => {
    const result = assertBookingTransition("completed", "cancelled");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/completed.*cancelled/);
  });
});

import { describe, expect, it } from "vitest";
import { buildBodyParams, formatWhen, templateForType } from "../src/whatsapp/messages.js";
import { zonedTimeToUtcMs } from "@vaanidesk/shared";

const IST = "Asia/Kolkata";

const ctx = {
  customerName: "Rohit",
  serviceName: "Haircut",
  startsAtMs: zonedTimeToUtcMs("2026-07-21", 17 * 60 + 30, IST),
  timezone: IST,
  businessName: "Glow Salon Andheri",
  priceDisplay: "₹400",
};

describe("formatWhen", () => {
  it("renders business-local weekday, date, and 12h time", () => {
    const when = formatWhen(ctx.startsAtMs, IST);
    expect(when).toContain("Tue");
    expect(when).toContain("21");
    expect(when).toContain("Jul");
    expect(when.toLowerCase()).toContain("5:30");
    expect(when.toLowerCase()).toContain("pm");
  });

  it("respects the timezone (same instant, different wall time)", () => {
    const ny = formatWhen(ctx.startsAtMs, "America/New_York");
    expect(ny.toLowerCase()).toContain("8:00"); // 17:30 IST == 08:00 EDT
    expect(ny.toLowerCase()).toContain("am");
  });
});

describe("buildBodyParams", () => {
  it("confirmation carries all five positional params in order", () => {
    const params = buildBodyParams("booking_confirmation", ctx);
    expect(params).toHaveLength(5);
    expect(params[0]).toBe("Rohit");
    expect(params[1]).toBe("Haircut");
    expect(params[2]).toContain("Tue");
    expect(params[3]).toBe("Glow Salon Andheri");
    expect(params[4]).toBe("₹400");
  });

  it("reminder and cancellation carry four params (no price)", () => {
    expect(buildBodyParams("booking_reminder", ctx)).toHaveLength(4);
    expect(buildBodyParams("booking_cancellation", ctx)).toHaveLength(4);
  });

  it("never produces empty params (template render would fail)", () => {
    for (const type of [
      "booking_confirmation",
      "booking_reminder",
      "booking_cancellation",
    ] as const) {
      for (const param of buildBodyParams(type, ctx)) {
        expect(param.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("templateForType", () => {
  const templates = { confirmation: "c", reminder: "r", cancellation: "x" };
  it("maps each job type to its template", () => {
    expect(templateForType("booking_confirmation", templates)).toBe("c");
    expect(templateForType("booking_reminder", templates)).toBe("r");
    expect(templateForType("booking_cancellation", templates)).toBe("x");
  });
});

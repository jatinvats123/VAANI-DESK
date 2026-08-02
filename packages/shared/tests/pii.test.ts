import { describe, expect, it } from "vitest";
import { maskPhoneNumbers, scrubPII } from "../src/pii.js";

describe("maskPhoneNumbers", () => {
  it("masks E.164 and Indian phone numbers embedded in text", () => {
    expect(maskPhoneNumbers("call +919876543210 now")).toBe("call +91••••••3210 now");
    expect(maskPhoneNumbers("from 9876543210")).toBe("from +91••••••3210");
  });

  it("leaves ids and timestamps that aren't phone numbers intact", () => {
    // 13-digit epoch ms — not a valid phone, so untouched.
    expect(maskPhoneNumbers("ts=1738368000000")).toBe("ts=1738368000000");
    expect(maskPhoneNumbers("order 12345")).toBe("order 12345");
  });
});

describe("scrubPII", () => {
  it("drops secret-bearing keys anywhere in the structure", () => {
    const event = {
      request: {
        headers: { authorization: "Bearer sk_live_abc", cookie: "session=xyz", accept: "json" },
      },
      extra: { INTERNAL_SERVICE_SECRET: "top-secret", apiKey: "k-123" },
    };
    const scrubbed = scrubPII(event);
    expect(scrubbed.request.headers.authorization).toBe("[redacted]");
    expect(scrubbed.request.headers.cookie).toBe("[redacted]");
    expect(scrubbed.request.headers.accept).toBe("json"); // non-secret preserved
    expect(scrubbed.extra.INTERNAL_SERVICE_SECRET).toBe("[redacted]");
    expect(scrubbed.extra.apiKey).toBe("[redacted]");
  });

  it("masks phone numbers in nested string values and arrays", () => {
    const scrubbed = scrubPII({
      message: "booking for +919876543210",
      breadcrumbs: [{ data: { fromNumber: "9876543210" } }],
    });
    expect(scrubbed.message).toBe("booking for +91••••••3210");
    expect(scrubbed.breadcrumbs[0].data.fromNumber).toBe("+91••••••3210");
  });

  it("does not mutate the input", () => {
    const input = { headers: { authorization: "secret" } };
    scrubPII(input);
    expect(input.headers.authorization).toBe("secret");
  });
});

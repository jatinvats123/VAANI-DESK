import { describe, expect, it } from "vitest";
import { AGENT_TOOL_NAMES, buildAnthropicTools, parseToolUse } from "../src/tools.js";

const SERVICE_ID = "8f14e45f-ceea-4e07-8c65-4e07acd1b2c3";

describe("buildAnthropicTools", () => {
  it("emits a definition per tool with JSON Schema input", () => {
    const tools = buildAnthropicTools();
    expect(tools.map((tool) => tool.name)).toEqual([...AGENT_TOOL_NAMES]);
    for (const tool of tools) {
      expect(tool.description.length).toBeGreaterThan(20);
      expect(tool.input_schema).toMatchObject({ type: "object" });
    }
  });

  it("marks required fields in the generated schema", () => {
    const createBooking = buildAnthropicTools().find((tool) => tool.name === "create_booking")!;
    const required = createBooking.input_schema.required as string[];
    expect(required).toEqual(
      expect.arrayContaining(["service_id", "date", "time", "customer_name"]),
    );
    expect(required).not.toContain("customer_phone");
  });
});

describe("parseToolUse", () => {
  it("parses valid input", () => {
    const result = parseToolUse("check_availability", {
      service_id: SERVICE_ID,
      date: "2026-07-21",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.parsed.name).toBe("check_availability");
      expect(result.parsed.input).toEqual({ service_id: SERVICE_ID, date: "2026-07-21" });
    }
  });

  it("rejects unknown tools with a correctable error", () => {
    const result = parseToolUse("answer_faq", {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("unknown_tool");
  });

  it("rejects malformed input with field-level messages", () => {
    const result = parseToolUse("create_booking", {
      service_id: "not-a-uuid",
      date: "21-07-2026",
      time: "5:30",
      customer_name: "",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("invalid_input");
      expect(result.error.message).toContain("service_id");
      expect(result.error.message).toContain("date");
      expect(result.error.message).toContain("time");
    }
  });

  it("accepts local time formats exactly (HH:MM 24h)", () => {
    const good = parseToolUse("create_booking", {
      service_id: SERVICE_ID,
      date: "2026-07-21",
      time: "17:30",
      customer_name: "Rohit",
    });
    expect(good.ok).toBe(true);
    const bad = parseToolUse("create_booking", {
      service_id: SERVICE_ID,
      date: "2026-07-21",
      time: "24:00",
      customer_name: "Rohit",
    });
    expect(bad.ok).toBe(false);
  });
});

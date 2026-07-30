import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  computeWhatsappSignature,
  verifyWhatsappSignature,
} from "../src/modules/webhooks/whatsapp-signature.js";

const SECRET = "test-app-secret";
const BODY = JSON.stringify({ object: "whatsapp_business_account", entry: [] });

describe("whatsapp webhook signature", () => {
  it("produces sha256=<hex hmac> over the raw body", () => {
    const expectedHex = createHmac("sha256", SECRET).update(BODY).digest("hex");
    expect(computeWhatsappSignature(SECRET, BODY)).toBe(`sha256=${expectedHex}`);
  });

  it("accepts a valid header and rejects everything else", () => {
    const valid = computeWhatsappSignature(SECRET, BODY);
    expect(verifyWhatsappSignature(SECRET, BODY, valid)).toBe(true);
    expect(verifyWhatsappSignature(SECRET, BODY, undefined)).toBe(false);
    expect(verifyWhatsappSignature(SECRET, BODY, "sha256=deadbeef")).toBe(false);
    expect(verifyWhatsappSignature(SECRET, `${BODY} `, valid)).toBe(false); // body tampered
    expect(verifyWhatsappSignature("other-secret", BODY, valid)).toBe(false);
  });

  it("is byte-exact: works on Buffers identically to strings", () => {
    const valid = computeWhatsappSignature(SECRET, Buffer.from(BODY, "utf8"));
    expect(verifyWhatsappSignature(SECRET, BODY, valid)).toBe(true);
  });
});

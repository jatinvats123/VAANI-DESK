import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Meta webhook signing: X-Hub-Signature-256 is "sha256=" + HMAC-SHA256 of the
 * raw request body with the app secret.
 * https://developers.facebook.com/docs/graph-api/webhooks/getting-started#validate-payloads
 */
export function computeWhatsappSignature(appSecret: string, rawBody: string | Buffer): string {
  return `sha256=${createHmac("sha256", appSecret).update(rawBody).digest("hex")}`;
}

export function verifyWhatsappSignature(
  appSecret: string,
  rawBody: string | Buffer,
  header: string | undefined,
): boolean {
  if (!header) return false;
  const expected = Buffer.from(computeWhatsappSignature(appSecret, rawBody), "utf8");
  const provided = Buffer.from(header, "utf8");
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}

import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Twilio request signing (X-Twilio-Signature): HMAC-SHA1 over the full public
 * URL concatenated with each POST parameter name+value in sorted key order,
 * base64-encoded. https://www.twilio.com/docs/usage/security#validating-requests
 */
export function computeTwilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
): string {
  const payload =
    url +
    Object.keys(params)
      .sort()
      .map((key) => key + params[key])
      .join("");
  return createHmac("sha1", authToken).update(payload, "utf8").digest("base64");
}

export function verifyTwilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
  signature: string | undefined,
): boolean {
  if (!signature) return false;
  const expected = Buffer.from(computeTwilioSignature(authToken, url, params), "utf8");
  const provided = Buffer.from(signature, "utf8");
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}

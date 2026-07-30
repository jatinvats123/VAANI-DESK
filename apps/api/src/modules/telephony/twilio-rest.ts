import { AppError } from "@vaanidesk/shared";

/**
 * Minimal Twilio REST client — one operation, no SDK. Redirects a live call to
 * new TwiML that dials the owner (the human-fallback path). Only the api holds
 * these credentials (ADR-0002); the gateway requests transfers through
 * /v1/internal/calls/:id/transfer.
 */

export interface TwilioRestCredentials {
  accountSid: string;
  authToken: string;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Originate an outbound call; Twilio fetches TwiML from `twimlUrl` on answer. */
export async function createOutboundCall(
  creds: TwilioRestCredentials,
  params: { from: string; to: string; twimlUrl: string; timeoutSec?: number },
): Promise<void> {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(
    creds.accountSid,
  )}/Calls.json`;
  const auth = Buffer.from(`${creds.accountSid}:${creds.authToken}`).toString("base64");
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      From: params.from,
      To: params.to,
      Url: params.twimlUrl,
      Method: "POST",
      Timeout: String(params.timeoutSec ?? 25),
    }).toString(),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw AppError.internal(
      `Twilio outbound call failed (${response.status}): ${body.slice(0, 300)}`,
    );
  }
}

export async function redirectCallToDial(
  creds: TwilioRestCredentials,
  providerCallId: string,
  dialTo: string,
  options: { callerId?: string; timeoutSec?: number } = {},
): Promise<void> {
  const dialAttrs = [
    `timeout="${options.timeoutSec ?? 25}"`,
    ...(options.callerId ? [`callerId="${escapeXml(options.callerId)}"`] : []),
  ].join(" ");
  const twiml =
    `<?xml version="1.0" encoding="UTF-8"?><Response>` +
    `<Dial ${dialAttrs}>${escapeXml(dialTo)}</Dial>` +
    `</Response>`;

  const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(
    creds.accountSid,
  )}/Calls/${encodeURIComponent(providerCallId)}.json`;
  const auth = Buffer.from(`${creds.accountSid}:${creds.authToken}`).toString("base64");

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ Twiml: twiml }).toString(),
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw AppError.internal(
      `Twilio call redirect failed (${response.status}): ${body.slice(0, 300)}`,
    );
  }
}

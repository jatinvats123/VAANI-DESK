import type { Env } from "./env.js";
import type { Logger } from "./logger.js";
import { RetryableJobError } from "./handlers.js";

/**
 * Missed-call auto-callback: the worker only relays to the api's callback
 * endpoint — the api owns the state checks (open hours, existing bookings)
 * and the Twilio REST credentials (ADR-0002). 4xx = intentional skip, 5xx or
 * network = retry with backoff.
 */
export async function handleMissedCallCallback(
  deps: { env: Env; log: Logger },
  payload: { callId: string; businessId: string },
): Promise<void> {
  const { env, log } = deps;
  let response: Response;
  try {
    response = await fetch(`${env.API_BASE_URL}/v1/internal/callbacks`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.INTERNAL_SERVICE_SECRET}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ businessId: payload.businessId, callId: payload.callId }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    throw new RetryableJobError(error instanceof Error ? error.message : "api unreachable");
  }

  if (response.ok) {
    log.info({ callId: payload.callId }, "missed-call callback initiated");
    return;
  }
  const body = (await response.json().catch(() => undefined)) as
    { error?: { message?: string } } | undefined;
  const reason = body?.error?.message ?? `HTTP ${response.status}`;
  if (response.status >= 500) throw new RetryableJobError(reason);
  // Business closed / caller already booked / provider unsupported — done.
  log.info({ callId: payload.callId, reason }, "missed-call callback skipped");
}

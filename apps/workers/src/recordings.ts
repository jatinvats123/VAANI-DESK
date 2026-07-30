import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { recordingStorageKey } from "@vaanidesk/shared";
import type { Dal } from "@vaanidesk/db";
import type { Env } from "./env.js";
import type { Logger } from "./logger.js";
import { RetryableJobError } from "./handlers.js";

/**
 * Recording migration (ADR-0006 security requirement): pull the provider-hosted
 * recording and re-home it in our private bucket, then point calls.recording_key
 * at the bucket key. Playback then goes exclusively through the api's
 * signed-URL endpoint — provider URLs never reach a browser.
 */

export interface RecordingDeps {
  dal: Dal;
  env: Env;
  log: Logger;
}

export function createS3Client(env: Env): S3Client | undefined {
  if (!env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY) return undefined;
  return new S3Client({
    region: env.S3_REGION,
    ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT, forcePathStyle: true } : {}),
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    },
  });
}

export async function handleRecordingMigration(
  deps: RecordingDeps & { s3: S3Client | undefined },
  payload: { callId: string; businessId: string; sourceUrl: string },
): Promise<void> {
  const { dal, env, log, s3 } = deps;
  const tenant = dal.forBusiness(payload.businessId);
  const call = await tenant.calls.getById(payload.callId);
  if (!call) {
    log.warn({ callId: payload.callId }, "recording job for unknown call — dropping");
    return;
  }
  const key = recordingStorageKey(payload.businessId, payload.callId);
  if (call.recordingKey === key) return; // already migrated — idempotent retry

  if (!s3) {
    log.warn({ callId: call.id }, "S3 not configured — recording stays provider-hosted");
    return;
  }

  // Twilio recording URLs require basic auth; .wav is appended per their API.
  const isTwilio = payload.sourceUrl.includes("api.twilio.com");
  const url = isTwilio ? `${payload.sourceUrl}.wav` : payload.sourceUrl;
  const headers: Record<string, string> = {};
  if (isTwilio) {
    if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN) {
      log.warn({ callId: call.id }, "Twilio credentials missing — cannot fetch recording");
      return;
    }
    headers.Authorization = `Basic ${Buffer.from(
      `${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`,
    ).toString("base64")}`;
  }

  let response: Response;
  try {
    response = await fetch(url, { headers, signal: AbortSignal.timeout(60_000) });
  } catch (error) {
    throw new RetryableJobError(error instanceof Error ? error.message : "recording fetch failed");
  }
  if (response.status === 404) {
    // Twilio may still be finalizing — retry via backoff.
    throw new RetryableJobError("recording not ready yet (404)");
  }
  if (!response.ok) {
    throw new RetryableJobError(`recording fetch HTTP ${response.status}`);
  }
  const audio = Buffer.from(await response.arrayBuffer());

  await s3.send(
    new PutObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: key,
      Body: audio,
      ContentType: "audio/wav",
    }),
  );
  await tenant.calls.setRecording(call.id, key);
  await tenant.audit.record({
    actorType: "system",
    actorId: "workers",
    action: "call.recording_migrated",
    entityType: "call",
    entityId: call.id,
    metadata: { key, bytes: audio.length },
  });
  log.info({ callId: call.id, bytes: audio.length }, "recording migrated to private bucket");
}

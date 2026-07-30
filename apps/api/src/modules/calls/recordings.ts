import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Env } from "../../env.js";

/**
 * Signed playback URLs for the private recordings bucket. Short-lived (15min)
 * so a leaked dashboard link goes stale before it goes far; every issuance is
 * audit-logged by the route.
 */

export const RECORDING_URL_TTL_SECONDS = 15 * 60;

export interface RecordingSigner {
  available: boolean;
  signedUrlForKey(key: string): Promise<string>;
}

export function createRecordingSigner(env: Env): RecordingSigner {
  if (!env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY) {
    return {
      available: false,
      signedUrlForKey: () => Promise.reject(new Error("S3 not configured")),
    };
  }
  const client = new S3Client({
    region: env.S3_REGION,
    ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT, forcePathStyle: true } : {}),
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    },
  });
  return {
    available: true,
    signedUrlForKey: (key: string) =>
      getSignedUrl(client, new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }), {
        expiresIn: RECORDING_URL_TTL_SECONDS,
      }),
  };
}

/** Keys we minted (vs provider URLs still awaiting migration). */
export function isBucketKey(recordingKey: string): boolean {
  return recordingKey.startsWith("recordings/");
}

"use server";

import { ApiError, apiFetch } from "@/lib/api";

export interface RecordingUrlState {
  url?: string;
  expiresInSeconds?: number;
  /** "processing" (migration pending) or a human-readable failure. */
  error?: string;
}

/** Signed playback URL — issued on demand, short-lived, access audited by the api. */
export async function getRecordingUrlAction(
  businessId: string,
  callId: string,
): Promise<RecordingUrlState> {
  try {
    return await apiFetch<{ url: string; expiresInSeconds: number }>(
      `/v1/businesses/${businessId}/calls/${callId}/recording-url`,
    );
  } catch (error) {
    if (error instanceof ApiError) {
      return {
        error:
          error.code === "conflict"
            ? "Recording is still processing — try again in a minute."
            : error.message,
      };
    }
    throw error;
  }
}

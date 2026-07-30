"use client";

import { useState, useTransition } from "react";
import { getRecordingUrlAction } from "@/app/(dashboard)/calls/actions";

/**
 * Loads the signed URL only when the owner presses play — recordings are
 * sensitive, so no URL is minted (or audit-logged) for a page view alone.
 * Signed URLs expire in ~15min; a fresh press fetches a fresh one.
 */
export function RecordingPlayer({ businessId, callId }: { businessId: string; callId: string }) {
  const [url, setUrl] = useState<string>();
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  if (url) {
    // No caption track — the transcript rendered below the player serves that role.
    return (
      <audio controls autoPlay src={url} className="h-9 w-full max-w-64">
        Your browser cannot play this recording.
      </audio>
    );
  }

  return (
    <div>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(undefined);
            const result = await getRecordingUrlAction(businessId, callId);
            if (result.url) setUrl(result.url);
            else setError(result.error ?? "Could not load the recording.");
          })
        }
        className="rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-xs font-medium text-ink transition hover:border-ink-faint disabled:opacity-60"
      >
        {pending ? "Loading…" : "▶ Play recording"}
      </button>
      {error ? <p className="mt-1.5 text-xs text-ink-muted">{error}</p> : null}
    </div>
  );
}

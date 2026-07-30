import "server-only";
import { cookies } from "next/headers";

/**
 * Server-side client for the api service. The session cookie is forwarded, so
 * the api enforces auth + tenancy exactly as it does for any client — web has
 * no privileged path (ADR-0002: the api is the single writer).
 */

const API_URL = process.env.API_INTERNAL_URL ?? "http://localhost:4000";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function apiFetch<T>(
  path: string,
  init: {
    method?: "GET" | "POST" | "PATCH";
    body?: unknown;
    searchParams?: Record<string, string>;
  } = {},
): Promise<T> {
  const cookieStore = await cookies();
  const url = new URL(`${API_URL}${path}`);
  for (const [key, value] of Object.entries(init.searchParams ?? {})) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url, {
    method: init.method ?? "GET",
    cache: "no-store",
    headers: {
      cookie: cookieStore.toString(),
      ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });

  const json = (await response.json().catch(() => undefined)) as
    (T & { error?: { code: string; message: string; details?: unknown } }) | undefined;

  if (!response.ok) {
    const envelope = json?.error;
    throw new ApiError(
      response.status,
      envelope?.code ?? "internal_error",
      envelope?.message ?? `API request failed (${response.status})`,
      envelope?.details,
    );
  }
  return json as T;
}

import { timingSafeEqual } from "node:crypto";
import type { Registry } from "prom-client";

/**
 * Framework-agnostic helpers for exposing `/metrics`. The endpoint is guarded
 * by the internal service secret (same shared secret the gateway uses to reach
 * the api) so a scraper must present a bearer token — metrics leak call volumes
 * and internal names, so they are not public.
 */

/** Constant-time bearer check against the internal service secret. */
export function bearerMatches(authorizationHeader: string | undefined, secret: string): boolean {
  const token = authorizationHeader?.startsWith("Bearer ")
    ? authorizationHeader.slice("Bearer ".length)
    : undefined;
  if (!token || secret.length === 0) return false;
  const provided = Buffer.from(token, "utf8");
  const expected = Buffer.from(secret, "utf8");
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

export interface RenderedMetrics {
  contentType: string;
  body: string;
}

/** Render the registry in Prometheus text exposition format. */
export async function renderMetrics(registry: Registry): Promise<RenderedMetrics> {
  return { contentType: registry.contentType, body: await registry.metrics() };
}

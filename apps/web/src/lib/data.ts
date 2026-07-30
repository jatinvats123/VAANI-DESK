import "server-only";
import { apiFetch } from "./api.js";
import type {
  AnalyticsResponse,
  BookingDto,
  BusinessDto,
  CallDto,
  CallTurnDto,
  MeResponse,
  ServiceDto,
} from "./types.js";

/** Typed reads over /v1 — every dashboard page fetches through these. */

export const getMe = () => apiFetch<MeResponse>("/v1/me");

export const getBusiness = (businessId: string) =>
  apiFetch<{ business: BusinessDto }>(`/v1/businesses/${businessId}`);

export const getAnalytics = (businessId: string, days: number) =>
  apiFetch<AnalyticsResponse>(`/v1/businesses/${businessId}/analytics`, {
    searchParams: { days: String(days) },
  });

export const listServices = (businessId: string, includeInactive = false) =>
  apiFetch<{ services: ServiceDto[] }>(`/v1/businesses/${businessId}/services`, {
    searchParams: { includeInactive: String(includeInactive) },
  });

export const listBookings = (businessId: string, fromIso: string, toIso: string) =>
  apiFetch<{ bookings: BookingDto[] }>(`/v1/businesses/${businessId}/bookings`, {
    searchParams: { from: fromIso, to: toIso },
  });

export const listCalls = (businessId: string, opts: { limit?: number; cursor?: string } = {}) =>
  apiFetch<{ calls: CallDto[]; nextCursor: string | null }>(`/v1/businesses/${businessId}/calls`, {
    searchParams: {
      limit: String(opts.limit ?? 25),
      ...(opts.cursor !== undefined ? { cursor: opts.cursor } : {}),
    },
  });

export const getCall = (businessId: string, callId: string) =>
  apiFetch<{ call: CallDto; turns: CallTurnDto[] }>(`/v1/businesses/${businessId}/calls/${callId}`);

"use server";

import { revalidatePath } from "next/cache";
import { ApiError, apiFetch } from "@/lib/api";
import { formString } from "@/lib/forms";

/**
 * Booking mutations — thin server actions over /v1. The api owns validation,
 * tenancy, and the availability invariant; these just shuttle and revalidate.
 */

export async function cancelBookingAction(businessId: string, bookingId: string): Promise<void> {
  await apiFetch(`/v1/businesses/${businessId}/bookings/${bookingId}/cancel`, {
    method: "POST",
    body: { reason: "Cancelled from dashboard" },
  });
  revalidatePath("/bookings");
  revalidatePath("/dashboard");
}

export async function setBookingStatusAction(
  businessId: string,
  bookingId: string,
  status: "completed" | "no_show",
): Promise<void> {
  await apiFetch(`/v1/businesses/${businessId}/bookings/${bookingId}/status`, {
    method: "POST",
    body: { status },
  });
  revalidatePath("/bookings");
}

export interface CreateBookingFormState {
  error?: string;
  alternatives?: Array<{ startsAt: string; label: string }>;
  ok?: boolean;
}

export async function createBookingAction(
  businessId: string,
  timezone: string,
  _prev: CreateBookingFormState,
  formData: FormData,
): Promise<CreateBookingFormState> {
  const serviceId = formString(formData, "serviceId");
  const date = formString(formData, "date");
  const time = formString(formData, "time");
  const customerName = formString(formData, "customerName").trim();
  const customerPhone = formString(formData, "customerPhone").trim();
  if (!serviceId || !date || !time || !customerName || !customerPhone) {
    return { error: "All fields are required." };
  }

  // Interpret the picked date+time in the business's timezone.
  const { zonedTimeToUtcMs, parseHM } = await import("@vaanidesk/shared");
  let startsAt: string;
  try {
    startsAt = new Date(zonedTimeToUtcMs(date, parseHM(time), timezone)).toISOString();
  } catch {
    return { error: "Invalid date or time." };
  }

  try {
    await apiFetch(`/v1/businesses/${businessId}/bookings`, {
      method: "POST",
      body: { serviceId, startsAt, customerName, customerPhone },
    });
  } catch (error) {
    if (error instanceof ApiError) {
      const details = error.details as
        { alternatives?: Array<{ startsAt: string; label: string }> } | undefined;
      return {
        error: error.message,
        ...(details?.alternatives ? { alternatives: details.alternatives } : {}),
      };
    }
    throw error;
  }
  revalidatePath("/bookings");
  revalidatePath("/dashboard");
  return { ok: true };
}

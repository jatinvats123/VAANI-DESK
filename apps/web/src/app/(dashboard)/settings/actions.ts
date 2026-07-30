"use server";

import { revalidatePath } from "next/cache";
import { ApiError, apiFetch } from "@/lib/api";
import { formNumber, formString } from "@/lib/forms";

/**
 * Owner settings mutations — thin server actions over PATCH /v1/businesses and
 * the services endpoints. The api enforces the owner role (ADR-0004); these
 * shuttle validated-enough form data and let the api's zod schemas be the law.
 */

export interface SettingsFormState {
  ok?: boolean;
  error?: string;
}

function toState(error: unknown): SettingsFormState {
  if (error instanceof ApiError) return { error: error.message };
  throw error;
}

const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

export async function updateHoursAction(
  businessId: string,
  _prev: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  const weekly: Record<string, Array<{ open: string; close: string }>> = {};
  for (const day of WEEKDAYS) {
    const closed = formData.get(`closed-${day}`) === "on";
    const open = formString(formData, `open-${day}`);
    const close = formString(formData, `close-${day}`);
    weekly[day] = closed || !open || !close ? [] : [{ open, close }];
  }
  try {
    await apiFetch(`/v1/businesses/${businessId}`, {
      method: "PATCH",
      body: { hours: { weekly, exceptions: [] } },
    });
  } catch (error) {
    return toState(error);
  }
  revalidatePath("/settings");
  return { ok: true };
}

export async function upsertServiceAction(
  businessId: string,
  _prev: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  const serviceId = formString(formData, "serviceId");
  const name = formString(formData, "name").trim();
  const durationMin = formNumber(formData, "durationMin");
  const priceRupees = formNumber(formData, "priceRupees");
  if (!name || !Number.isFinite(durationMin) || !Number.isFinite(priceRupees)) {
    return { error: "Name, duration, and price are required." };
  }
  const body = { name, durationMin, pricePaise: Math.round(priceRupees * 100) };
  try {
    if (serviceId === "") {
      await apiFetch(`/v1/businesses/${businessId}/services`, { method: "POST", body });
    } else {
      await apiFetch(`/v1/businesses/${businessId}/services/${serviceId}`, {
        method: "PATCH",
        body,
      });
    }
  } catch (error) {
    return toState(error);
  }
  revalidatePath("/settings");
  return { ok: true };
}

export async function setServiceActiveAction(
  businessId: string,
  serviceId: string,
  active: boolean,
): Promise<void> {
  await apiFetch(`/v1/businesses/${businessId}/services/${serviceId}`, {
    method: "PATCH",
    body: { active },
  });
  revalidatePath("/settings");
}

export async function updateAgentConfigAction(
  businessId: string,
  _prev: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  const primaryLanguage = formString(formData, "primaryLanguage") || "hinglish";
  const greeting = formString(formData, "greeting").trim();
  const customInstructions = formString(formData, "customInstructions").trim();
  const ownerPhone = formString(formData, "ownerPhone").trim();
  const faqs = formString(formData, "faqs")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.includes("|"))
    .slice(0, 50)
    .map((line) => {
      const [question = "", ...answerParts] = line.split("|");
      return { question: question.trim(), answer: answerParts.join("|").trim() };
    })
    .filter((faq) => faq.question.length > 0 && faq.answer.length > 0);

  try {
    await apiFetch(`/v1/businesses/${businessId}`, {
      method: "PATCH",
      body: {
        promptConfig: {
          primaryLanguage,
          faqs,
          ...(greeting !== "" ? { greeting } : {}),
          ...(customInstructions !== "" ? { customInstructions } : {}),
        },
        ...(ownerPhone !== "" ? { ownerPhone } : {}),
      },
    });
  } catch (error) {
    return toState(error);
  }
  revalidatePath("/settings");
  return { ok: true };
}

export async function updatePolicyAction(
  businessId: string,
  _prev: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  try {
    await apiFetch(`/v1/businesses/${businessId}`, {
      method: "PATCH",
      body: {
        slotGranularityMin: formNumber(formData, "slotGranularityMin"),
        bookingBufferMin: formNumber(formData, "bookingBufferMin"),
        minNoticeMin: formNumber(formData, "minNoticeMin"),
        maxAdvanceDays: formNumber(formData, "maxAdvanceDays"),
      },
    });
  } catch (error) {
    return toState(error);
  }
  revalidatePath("/settings");
  return { ok: true };
}

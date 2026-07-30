"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ApiError, apiFetch } from "@/lib/api";
import { formNumber, formString } from "@/lib/forms";
import type { BusinessDto, ServiceDto } from "@/lib/types";

export interface WizardState {
  ok?: boolean;
  error?: string;
  businessId?: string;
  /** Set by addServiceAction on success — the wizard shows the running list. */
  addedName?: string;
}

function toWizardError(error: unknown): WizardState {
  if (error instanceof ApiError) return { error: error.message };
  throw error;
}

export async function createBusinessAction(
  _prev: WizardState,
  formData: FormData,
): Promise<WizardState> {
  const name = formString(formData, "name").trim();
  const timezone = formString(formData, "timezone") || "Asia/Kolkata";
  if (name.length < 2) return { error: "Give your business a name." };
  try {
    const { business } = await apiFetch<{ business: BusinessDto }>("/v1/businesses", {
      method: "POST",
      body: { name, timezone },
    });
    const cookieStore = await cookies();
    cookieStore.set("vd-business", business.id, { path: "/", sameSite: "lax" });
    return { ok: true, businessId: business.id };
  } catch (error) {
    return toWizardError(error);
  }
}

export async function addServiceAction(
  businessId: string,
  _prev: WizardState,
  formData: FormData,
): Promise<WizardState> {
  const name = formString(formData, "serviceName").trim();
  const durationMin = formNumber(formData, "durationMin");
  const priceRupees = formNumber(formData, "priceRupees");
  if (!name || !Number.isFinite(durationMin) || !Number.isFinite(priceRupees)) {
    return { error: "Name, duration, and price are required." };
  }
  try {
    await apiFetch<{ service: ServiceDto }>(`/v1/businesses/${businessId}/services`, {
      method: "POST",
      body: { name, durationMin, pricePaise: Math.round(priceRupees * 100) },
    });
    return { ok: true, addedName: name };
  } catch (error) {
    return toWizardError(error);
  }
}

const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

export async function saveHoursAction(
  businessId: string,
  _prev: WizardState,
  formData: FormData,
): Promise<WizardState> {
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
    return { ok: true };
  } catch (error) {
    return toWizardError(error);
  }
}

export async function finishOnboardingAction(
  businessId: string,
  _prev: WizardState,
  formData: FormData,
): Promise<WizardState> {
  const primaryLanguage = formString(formData, "primaryLanguage") || "hinglish";
  const ownerPhone = formString(formData, "ownerPhone").trim();
  const faqsRaw = formString(formData, "faqs").trim();

  const faqs = faqsRaw
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
        promptConfig: { primaryLanguage, faqs },
        ...(ownerPhone !== "" ? { ownerPhone } : {}),
      },
    });
    await apiFetch(`/v1/businesses/${businessId}/complete-onboarding`, { method: "POST" });
  } catch (error) {
    return toWizardError(error);
  }
  redirect("/dashboard");
}

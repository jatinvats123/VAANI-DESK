"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getMe } from "@/lib/data";

/**
 * Switch the active business. Membership is validated here AND on every
 * subsequent read (requireBusiness ignores cookies that don't match a real
 * membership) — the cookie is a preference, never an authority.
 */
export async function setActiveBusinessAction(businessId: string): Promise<void> {
  const me = await getMe();
  if (!me.businesses.some((b) => b.id === businessId)) return;
  const cookieStore = await cookies();
  cookieStore.set("vd-business", businessId, {
    path: "/",
    sameSite: "lax",
    maxAge: 365 * 24 * 3600,
  });
  redirect("/dashboard");
}

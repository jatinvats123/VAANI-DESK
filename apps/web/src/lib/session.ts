import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getMe } from "./data.js";
import type { MeResponse } from "./types.js";

const BUSINESS_COOKIE = "vd-business";

export interface ActiveBusiness {
  id: string;
  name: string;
  role: MeResponse["businesses"][number]["role"];
  onboarded: boolean;
}

/** DB-backed session check — the middleware only did the optimistic cookie test. */
export async function requireUser() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  return session.user;
}

/**
 * Resolve which business this session is operating on: the vd-business cookie
 * if it points at a real membership, otherwise the first business. No
 * businesses at all → onboarding.
 */
export async function requireBusiness(): Promise<{ me: MeResponse; business: ActiveBusiness }> {
  await requireUser();
  const me = await getMe();
  if (me.businesses.length === 0) redirect("/onboarding");

  const cookieStore = await cookies();
  const preferred = cookieStore.get(BUSINESS_COOKIE)?.value;
  const chosen = me.businesses.find((b) => b.id === preferred) ?? me.businesses[0]!;
  return {
    me,
    business: {
      id: chosen.id,
      name: chosen.name,
      role: chosen.role,
      onboarded: chosen.onboarded,
    },
  };
}

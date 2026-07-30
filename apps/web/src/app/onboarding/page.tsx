import { redirect } from "next/navigation";
import { OnboardingWizard } from "@/components/onboarding-wizard";
import { getMe } from "@/lib/data";
import { requireUser } from "@/lib/session";

export const metadata = { title: "Get started" };

export default async function OnboardingPage() {
  await requireUser();
  const me = await getMe();
  const onboarded = me.businesses.find((b) => b.onboarded);
  if (onboarded) redirect("/dashboard");
  const pending = me.businesses[0] ?? null;

  return (
    <main className="flex min-h-dvh flex-col items-center bg-bg px-4 py-10">
      <p className="mb-8 font-display text-2xl font-bold tracking-tight text-ink">
        Vaani<span className="text-accent">Desk</span>
      </p>
      <OnboardingWizard existingBusinessId={pending?.id ?? null} />
      <p className="mt-8 max-w-sm text-center text-xs text-ink-faint">
        Ten minutes now, and every missed call becomes a booking. You can change all of this later
        in Settings.
      </p>
    </main>
  );
}

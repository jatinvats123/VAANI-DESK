import Link from "next/link";
import { redirect } from "next/navigation";
import { signOut } from "@/auth";
import { requireBusiness } from "@/lib/session";
import { NavLinks, MobileNav } from "@/components/nav";
import { BusinessSwitcher } from "@/components/business-switcher";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { me, business } = await requireBusiness();
  if (!business.onboarded) redirect("/onboarding");

  return (
    <div className="min-h-dvh bg-bg lg:flex">
      {/* Desktop sidebar */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-surface px-4 py-6 lg:flex">
        <Link href="/dashboard" className="px-2 font-display text-xl font-bold tracking-tight">
          Vaani<span className="text-accent">Desk</span>
        </Link>
        <div className="mt-2 px-2">
          <BusinessSwitcher
            businesses={me.businesses.map((b) => ({ id: b.id, name: b.name }))}
            activeId={business.id}
          />
        </div>
        <nav className="mt-8 flex flex-1 flex-col gap-1">
          <NavLinks />
        </nav>
        <div className="border-t border-border pt-4">
          <p className="truncate px-2 text-xs text-ink-muted">{me.user.email}</p>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/login" });
            }}
          >
            <button
              type="submit"
              className="mt-2 w-full rounded-lg px-2 py-1.5 text-left text-xs text-ink-faint transition hover:bg-surface-2 hover:text-ink"
            >
              Sign out
            </button>
          </form>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-border bg-surface/90 px-4 py-3 backdrop-blur lg:hidden">
        <Link href="/dashboard" className="font-display text-lg font-bold tracking-tight">
          Vaani<span className="text-accent">Desk</span>
        </Link>
        <div className="max-w-[55%]">
          <BusinessSwitcher
            businesses={me.businesses.map((b) => ({ id: b.id, name: b.name }))}
            activeId={business.id}
          />
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-24 pt-6 lg:px-8 lg:pb-10">
        {children}
      </main>

      {/* Mobile bottom tabs — 60% of owners are on their phone */}
      <MobileNav />
    </div>
  );
}

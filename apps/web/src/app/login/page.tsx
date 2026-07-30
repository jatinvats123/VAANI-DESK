import { redirect } from "next/navigation";
import { auth, signIn } from "@/auth";

export const metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const session = await auth();
  const { next } = await searchParams;
  const redirectTo = next?.startsWith("/") ? next : "/dashboard";
  if (session?.user) redirect(redirectTo);

  return (
    <main className="flex min-h-dvh items-center justify-center bg-bg px-4">
      <div className="w-full max-w-sm">
        <div className="mb-10 text-center">
          <p className="font-display text-3xl font-bold tracking-tight text-ink">
            Vaani<span className="text-accent">Desk</span>
          </p>
          <p className="mt-2 text-sm text-ink-muted">
            Your AI receptionist. Never miss a booking again.
          </p>
        </div>

        <div className="rounded-2xl border border-border bg-surface p-6 shadow-sm">
          <form
            action={async () => {
              "use server";
              await signIn("google", { redirectTo });
            }}
          >
            <button
              type="submit"
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-surface-2 px-4 py-2.5 text-sm font-medium text-ink transition hover:border-ink-faint"
            >
              <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
                <path
                  fill="currentColor"
                  d="M21.35 11.1H12v2.9h5.35c-.5 2.4-2.55 3.9-5.35 3.9a5.9 5.9 0 1 1 0-11.8c1.5 0 2.85.55 3.9 1.45l2.15-2.15A8.9 8.9 0 1 0 12 20.9c5.15 0 8.8-3.6 8.8-8.7 0-.4-.05-.75-.1-1.1Z"
                />
              </svg>
              Continue with Google
            </button>
          </form>

          <div className="my-5 flex items-center gap-3 text-xs text-ink-faint">
            <div className="h-px flex-1 bg-border" />
            or
            <div className="h-px flex-1 bg-border" />
          </div>

          <form
            action={async (formData: FormData) => {
              "use server";
              await signIn("resend", {
                email: formData.get("email"),
                redirectTo,
              });
            }}
            className="space-y-3"
          >
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-ink-muted">Work email</span>
              <input
                type="email"
                name="email"
                required
                placeholder="owner@salon.in"
                className="w-full rounded-xl border border-border bg-bg px-3.5 py-2.5 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-accent"
              />
            </label>
            <button
              type="submit"
              className="w-full rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-accent-strong"
            >
              Email me a sign-in link
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-xs text-ink-faint">
          Callers hear a recording notice; you agree to our fair-use terms.
        </p>
      </div>
    </main>
  );
}

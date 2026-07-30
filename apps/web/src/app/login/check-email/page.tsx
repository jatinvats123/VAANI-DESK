export const metadata = { title: "Check your email" };

export default function CheckEmailPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-bg px-4">
      <div className="max-w-sm rounded-2xl border border-border bg-surface p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-accent-soft text-2xl">
          ✉️
        </div>
        <h1 className="font-display text-xl font-bold text-ink">Check your inbox</h1>
        <p className="mt-2 text-sm text-ink-muted">
          We sent you a sign-in link. It expires in 24 hours — open it on this device.
        </p>
      </div>
    </main>
  );
}

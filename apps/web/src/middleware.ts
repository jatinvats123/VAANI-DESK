import { NextResponse, type NextRequest } from "next/server";

/**
 * Optimistic edge guard: redirect to /login when no session cookie exists.
 * Real session validation (DB-backed) happens in the dashboard layout — the
 * edge runtime has no database, so this only filters the obvious case cheaply.
 */
export function middleware(request: NextRequest) {
  const hasSession =
    request.cookies.has("authjs.session-token") ||
    request.cookies.has("__Secure-authjs.session-token");
  if (!hasSession) {
    const login = new URL("/login", request.url);
    login.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(login);
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/calls/:path*",
    "/bookings/:path*",
    "/settings/:path*",
    "/onboarding",
  ],
};

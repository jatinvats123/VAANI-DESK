import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Resend from "next-auth/providers/resend";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { schema } from "@vaanidesk/db";
import { getDb } from "./lib/db.js";

/**
 * Auth.js v5 with database sessions in the shared `sessions` table — the api
 * validates the same cookie (ADR-0004), so web and api agree on identity with
 * zero token exchange. Passwordless email (magic link via Resend) + Google.
 * The brief said "email OTP"; magic links are the Auth.js-native passwordless
 * flow — same UX promise, no custom code-crypto to get wrong.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(getDb().db, {
    usersTable: schema.users,
    accountsTable: schema.accounts,
    sessionsTable: schema.sessions,
    verificationTokensTable: schema.verificationTokens,
  }),
  session: { strategy: "database" },
  trustHost: true,
  providers: [
    Google,
    Resend({
      from: process.env.AUTH_EMAIL_FROM ?? "VaaniDesk <login@vaanidesk.dev>",
    }),
  ],
  pages: {
    signIn: "/login",
    verifyRequest: "/login/check-email",
  },
});

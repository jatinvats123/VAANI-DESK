import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createDal, createDatabase, schema } from "@vaanidesk/db";
import { eq } from "drizzle-orm";

/**
 * Seeds a deterministic e2e identity directly in the database: user + database
 * session (the exact mechanism Auth.js uses) + an onboarded business. Writes a
 * Playwright storage state carrying the session cookie — tests start signed in.
 */

const E2E_EMAIL = "e2e@vaanidesk.dev";
const SESSION_TOKEN = "e2e-session-token-000000000000000000";

export default async function globalSetup(): Promise<void> {
  const url = process.env.DATABASE_URL ?? "postgres://vaanidesk:vaanidesk@localhost:5432/vaanidesk";
  const { db, close } = createDatabase(url, { max: 1 });
  const dal = createDal(db);

  try {
    let [user] = await db.select().from(schema.users).where(eq(schema.users.email, E2E_EMAIL));
    user ??= (
      await db.insert(schema.users).values({ email: E2E_EMAIL, name: "E2E Owner" }).returning()
    )[0]!;

    await db.delete(schema.sessions).where(eq(schema.sessions.sessionToken, SESSION_TOKEN));
    await db.insert(schema.sessions).values({
      sessionToken: SESSION_TOKEN,
      userId: user.id,
      expires: new Date(Date.now() + 24 * 3600 * 1000),
    });

    const businesses = await dal.system.businesses.listForUser(user.id);
    if (businesses.length === 0) {
      const business = await dal.system.businesses.createWithOwner({
        name: "E2E Salon",
        slug: `e2e-salon-${Date.now()}`,
        ownerUserId: user.id,
      });
      const tenant = dal.forBusiness(business.id);
      const openDay = [{ open: "09:00", close: "21:00" }];
      await tenant.business.update({
        hours: {
          weekly: {
            mon: openDay,
            tue: openDay,
            wed: openDay,
            thu: openDay,
            fri: openDay,
            sat: openDay,
            sun: openDay,
          },
          exceptions: [],
        },
        onboardedAt: new Date(),
      });
      await tenant.services.create({ name: "Haircut", durationMin: 30, pricePaise: 40000 });
    }
  } finally {
    await close();
  }

  const stateDir = path.join(import.meta.dirname, ".auth");
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(
    path.join(stateDir, "state.json"),
    JSON.stringify({
      cookies: [
        {
          name: "authjs.session-token",
          value: SESSION_TOKEN,
          domain: "localhost",
          path: "/",
          httpOnly: true,
          secure: false,
          sameSite: "Lax",
          expires: Math.floor(Date.now() / 1000) + 24 * 3600,
        },
      ],
      origins: [],
    }),
  );
}

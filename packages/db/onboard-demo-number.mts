/**
 * Demo helper: point the seeded Glow Salon business at a given phone number so
 * an inbound call to that number resolves to the tenant (webhooks/telephony.ts
 * looks the business up by the dialed `To`). Idempotent.
 *
 * Run: pnpm --filter @vaanidesk/db exec tsx onboard-demo-number.mts [+E164]
 */
import { config } from "dotenv";
import { createDatabase } from "./src/client.js";
import { createDal } from "./src/dal/index.js";

config({ path: "../../.env" });
config();

const NUMBER = process.argv[2] ?? "+17372212163";
const SLUG = "glow-salon-andheri";
const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://vaanidesk:vaanidesk@localhost:5432/vaanidesk";

async function main(): Promise<void> {
  const { db, close } = createDatabase(DATABASE_URL, { max: 1 });
  const dal = createDal(db);
  try {
    const business = await dal.system.businesses.getBySlug(SLUG);
    if (!business) throw new Error(`Business ${SLUG} not found — run pnpm db:seed first`);
    const tenant = dal.forBusiness(business.id);
    await tenant.business.update({ phoneNumber: NUMBER });
    const updated = await dal.system.businesses.getByPhoneNumber(NUMBER);
    console.log(
      updated
        ? `OK: "${business.name}" (${business.id}) now answers calls to ${NUMBER}`
        : `FAILED: no business resolves to ${NUMBER}`,
    );
    process.exit(updated ? 0 : 1);
  } finally {
    await close();
  }
}

main().catch((e: unknown) => {
  console.error("onboard-demo-number failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});

/**
 * Local development seed: one demo salon with services, staff, hours, a few
 * bookings and a finished call with transcript — enough for every dashboard
 * screen to render real-looking data. Idempotent: re-running is a no-op.
 *
 * Run: pnpm db:seed (after docker-compose up + db:migrate)
 */
import { config } from "dotenv";
import { addDaysISO, utcToLocalDateISO, zonedTimeToUtcMs } from "@vaanidesk/shared";
import { createDatabase } from "./client.js";
import { createDal } from "./dal/index.js";
import { users } from "./schema/index.js";

config({ path: "../../.env" });
config();

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://vaanidesk:vaanidesk@localhost:5432/vaanidesk";

const TZ = "Asia/Kolkata";

async function main(): Promise<void> {
  const { db, close } = createDatabase(DATABASE_URL, { max: 1 });
  const dal = createDal(db);

  try {
    const existing = await dal.system.businesses.getBySlug("glow-salon-andheri");
    if (existing) {
      console.log("Seed already applied (glow-salon-andheri exists) — nothing to do.");
      return;
    }

    // Owner user (Auth.js will link the real login to this row by email).
    const [owner] = await db
      .insert(users)
      .values({
        name: "Priya Sharma",
        email: "owner@vaanidesk.dev",
        phone: "+919820012345",
      })
      .returning();
    if (!owner) throw new Error("Failed to insert owner user");

    const openDay = [{ open: "10:00", close: "20:00" }];
    const business = await dal.system.businesses.createWithOwner({
      name: "Glow Salon Andheri",
      slug: "glow-salon-andheri",
      ownerUserId: owner.id,
      timezone: TZ,
      hours: {
        weekly: {
          mon: openDay,
          tue: openDay,
          wed: openDay,
          thu: openDay,
          fri: openDay,
          sat: [{ open: "09:00", close: "21:00" }],
          sun: [],
        },
        exceptions: [],
      },
      promptConfig: {
        primaryLanguage: "hinglish",
        faqs: [
          {
            question: "Where are you located?",
            answer: "Shop 12, Veera Desai Road, Andheri West, Mumbai — near Mrudul Tower.",
          },
          {
            question: "Do you take walk-ins?",
            answer: "Yes, but booked appointments get priority. Weekends are usually full.",
          },
          {
            question: "Is parking available?",
            answer: "Street parking on Veera Desai Road; paid parking at Mrudul Tower.",
          },
        ],
        customInstructions:
          "Regular customers often ask for Rekha didi — she is our senior stylist.",
      },
    });

    const tenant = dal.forBusiness(business.id);
    await tenant.business.update({
      phoneNumber: "+912261234500",
      ownerPhone: "+919820012345",
      notificationPhone: "+919820012345",
      onboardedAt: new Date(),
    });

    const [haircut, beardTrim, hairColour, facial] = await Promise.all([
      tenant.services.create({ name: "Haircut", durationMin: 30, pricePaise: 40000, sortOrder: 0 }),
      tenant.services.create({
        name: "Beard Trim",
        durationMin: 15,
        pricePaise: 15000,
        sortOrder: 1,
      }),
      tenant.services.create({
        name: "Hair Colour",
        durationMin: 90,
        pricePaise: 250000,
        sortOrder: 2,
      }),
      tenant.services.create({ name: "Facial", durationMin: 60, pricePaise: 120000, sortOrder: 3 }),
    ]);

    await Promise.all([
      tenant.resources.create({ name: "Rekha", type: "staff" }),
      tenant.resources.create({ name: "Sunil", type: "staff" }),
      tenant.resources.create({ name: "Aisha", type: "staff" }),
    ]);

    // A completed inbound call that produced a booking — powers the call detail view.
    const { call } = await tenant.calls.startIdempotent({
      provider: "twilio",
      providerCallId: "CA_seed_demo_0001",
      fromNumber: "+919876543210",
      toNumber: "+912261234500",
      startedAt: minutesAgo(95),
    });
    await tenant.calls.markAnswered(call.id, minutesAgo(95));

    const transcript: Array<{ role: "agent" | "caller"; text: string }> = [
      {
        role: "agent",
        text: "Namaste, Glow Salon Andheri! Yeh call record ho sakti hai. Main aapki kya madad kar sakti hoon?",
      },
      { role: "caller", text: "Haan, kal shaam ko haircut ke liye slot milega?" },
      {
        role: "agent",
        text: "Ji bilkul. Kal shaam 5 baje ya 5:30 baje free hai — kaunsa theek rahega?",
      },
      { role: "caller", text: "5:30 theek hai. Naam Rohit hai." },
      {
        role: "agent",
        text: "Done Rohit ji — kal shaam 5:30 baje haircut, 400 rupees. WhatsApp par confirmation aa jayega.",
      },
    ];
    for (const [i, turn] of transcript.entries()) {
      await tenant.calls.appendTurn(call.id, {
        turnIndex: i,
        role: turn.role,
        text: turn.text,
        startedAt: minutesAgo(95 - i),
        metrics: turn.role === "agent" ? { llmTtftMs: 380, ttsTtfbMs: 290, turnTotalMs: 1080 } : {},
      });
    }
    await tenant.calls.complete(call.id, {
      status: "completed",
      endedAt: minutesAgo(92),
      durationSec: 180,
      outcome: "booking_created",
      language: "hinglish",
      totalCostPaise: 850,
      costBreakdown: { sttPaise: 120, llmPaise: 310, ttsPaise: 260, telephonyPaise: 160 },
      latencyRollup: {
        turnCount: 3,
        p50: { llmTtftMs: 380, ttsTtfbMs: 290, turnTotalMs: 1080 },
        p95: { llmTtftMs: 520, ttsTtfbMs: 340, turnTotalMs: 1420 },
      },
      tokenUsage: { inputTokens: 6400, outputTokens: 410 },
    });

    // Bookings across today and tomorrow (IST) so the calendar has content.
    const today = utcToLocalDateISO(Date.now(), TZ);
    const tomorrow = addDaysISO(today, 1);
    const at = (dateISO: string, hm: string): Date => {
      const [h = 0, m = 0] = hm.split(":").map(Number);
      return new Date(zonedTimeToUtcMs(dateISO, h * 60 + m, TZ));
    };

    const seedBookings = [
      { service: haircut, date: today, start: "11:00", name: "Amit Verma", phone: "+919812345001" },
      {
        service: facial,
        date: today,
        start: "15:00",
        name: "Sneha Kulkarni",
        phone: "+919812345002",
      },
      {
        service: hairColour,
        date: today,
        start: "17:00",
        name: "Farah Khan",
        phone: "+919812345003",
      },
      {
        service: haircut,
        date: tomorrow,
        start: "17:30",
        name: "Rohit",
        phone: "+919876543210",
        callId: call.id,
      },
      {
        service: beardTrim,
        date: tomorrow,
        start: "12:00",
        name: "Vikram Singh",
        phone: "+919812345004",
      },
    ];

    for (const [i, entry] of seedBookings.entries()) {
      const startsAt = at(entry.date, entry.start);
      await tenant.bookings.createIdempotent({
        serviceId: entry.service.id,
        callId: entry.callId ?? null,
        customerName: entry.name,
        customerPhone: entry.phone,
        startsAt,
        endsAt: new Date(startsAt.getTime() + entry.service.durationMin * 60_000),
        source: entry.callId ? "voice" : "dashboard",
        pricePaise: entry.service.pricePaise,
        idempotencyKey: `seed-booking-${i}`,
      });
    }

    await tenant.audit.record({
      actorType: "system",
      actorId: "seed",
      action: "seed.applied",
      metadata: { bookings: seedBookings.length },
    });

    console.log(`Seeded business ${business.name} (${business.id})`);
    console.log(`  owner login: owner@vaanidesk.dev`);
    console.log(`  services: 4 · staff: 3 · bookings: ${seedBookings.length} · calls: 1`);
  } finally {
    await close();
  }
}

function minutesAgo(min: number): Date {
  return new Date(Date.now() - min * 60_000);
}

main().catch((error: unknown) => {
  console.error("Seed failed:", error);
  process.exitCode = 1;
});

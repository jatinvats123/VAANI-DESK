import {
  AppError,
  DEFAULT_PROMPT_CONFIG,
  EMPTY_WEEKLY_HOURS,
  type BusinessHours,
  type PromptConfig,
} from "@vaanidesk/shared";
import type { TelephonyProvider } from "@vaanidesk/core";
import { and, eq } from "drizzle-orm";
import type { DbExecutor } from "../client.js";
import { businesses, calls, memberships, users, webhookEvents } from "../schema/index.js";
import type { Business, Call, Membership, User, WebhookEvent } from "../types.js";

/**
 * Deliberately narrow unscoped operations — the only queries in the system that
 * run without a business_id: webhook ingestion (business unknown until lookup),
 * auth, and business bootstrap. Everything else goes through the tenant DAL.
 */
export function createSystemDal(db: DbExecutor) {
  return {
    users: {
      async getById(id: string): Promise<User | undefined> {
        const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
        return rows[0];
      },

      async getByEmail(email: string): Promise<User | undefined> {
        const rows = await db
          .select()
          .from(users)
          .where(eq(users.email, email.toLowerCase()))
          .limit(1);
        return rows[0];
      },
    },

    businesses: {
      async getById(id: string): Promise<Business | undefined> {
        const rows = await db.select().from(businesses).where(eq(businesses.id, id)).limit(1);
        return rows[0];
      },

      async getBySlug(slug: string): Promise<Business | undefined> {
        const rows = await db.select().from(businesses).where(eq(businesses.slug, slug)).limit(1);
        return rows[0];
      },

      /** Inbound call routing: which tenant owns this provisioned number? */
      async getByPhoneNumber(phoneNumber: string): Promise<Business | undefined> {
        const rows = await db
          .select()
          .from(businesses)
          .where(eq(businesses.phoneNumber, phoneNumber))
          .limit(1);
        return rows[0];
      },

      async listForUser(
        userId: string,
      ): Promise<Array<{ business: Business; role: Membership["role"] }>> {
        const rows = await db
          .select({ business: businesses, role: memberships.role })
          .from(memberships)
          .innerJoin(businesses, eq(memberships.businessId, businesses.id))
          .where(eq(memberships.userId, userId))
          .orderBy(businesses.createdAt);
        return rows;
      },

      /** Bootstrap: business + owner membership atomically. */
      async createWithOwner(input: {
        name: string;
        slug: string;
        ownerUserId: string;
        timezone?: string;
        hours?: BusinessHours;
        promptConfig?: PromptConfig;
      }): Promise<Business> {
        return await db.transaction(async (tx) => {
          const inserted = await tx
            .insert(businesses)
            .values({
              name: input.name,
              slug: input.slug,
              timezone: input.timezone ?? "Asia/Kolkata",
              hours: input.hours ?? { weekly: EMPTY_WEEKLY_HOURS, exceptions: [] },
              promptConfig: input.promptConfig ?? DEFAULT_PROMPT_CONFIG,
            })
            .returning();
          const business = inserted[0];
          if (!business) throw AppError.internal("Business insert returned no row");
          await tx.insert(memberships).values({
            userId: input.ownerUserId,
            businessId: business.id,
            role: "owner",
          });
          return business;
        });
      },
    },

    memberships: {
      async get(userId: string, businessId: string): Promise<Membership | undefined> {
        const rows = await db
          .select()
          .from(memberships)
          .where(and(eq(memberships.userId, userId), eq(memberships.businessId, businessId)))
          .limit(1);
        return rows[0];
      },
    },

    calls: {
      /** Webhook reconciliation: status callbacks identify calls by provider SID. */
      async getByProviderCallId(
        provider: TelephonyProvider,
        providerCallId: string,
      ): Promise<Call | undefined> {
        const rows = await db
          .select()
          .from(calls)
          .where(and(eq(calls.provider, provider), eq(calls.providerCallId, providerCallId)))
          .limit(1);
        return rows[0];
      },
    },

    webhooks: {
      /**
       * Record an inbound webhook exactly once. Returns `isNew: false` for
       * replayed deliveries — callers must short-circuit on that.
       */
      async recordIfNew(input: {
        provider: string;
        eventId: string;
        eventType?: string;
        payload: unknown;
      }): Promise<{ event: WebhookEvent; isNew: boolean }> {
        const inserted = await db
          .insert(webhookEvents)
          .values({
            provider: input.provider,
            eventId: input.eventId,
            eventType: input.eventType,
            payload: input.payload,
          })
          .onConflictDoNothing({ target: [webhookEvents.provider, webhookEvents.eventId] })
          .returning();
        const first = inserted[0];
        if (first) return { event: first, isNew: true };

        const existing = await db
          .select()
          .from(webhookEvents)
          .where(
            and(
              eq(webhookEvents.provider, input.provider),
              eq(webhookEvents.eventId, input.eventId),
            ),
          )
          .limit(1);
        const event = existing[0];
        if (!event) throw AppError.internal("Webhook event vanished between insert and select");
        return { event, isNew: false };
      },

      async markProcessed(id: string): Promise<void> {
        await db
          .update(webhookEvents)
          .set({ status: "processed", processedAt: new Date(), error: null })
          .where(eq(webhookEvents.id, id));
      },

      async markFailed(id: string, error: string): Promise<void> {
        await db
          .update(webhookEvents)
          .set({ status: "failed", processedAt: new Date(), error })
          .where(eq(webhookEvents.id, id));
      },

      async markSkipped(id: string, reason: string): Promise<void> {
        await db
          .update(webhookEvents)
          .set({ status: "skipped", processedAt: new Date(), error: reason })
          .where(eq(webhookEvents.id, id));
      },
    },
  };
}

export type SystemDal = ReturnType<typeof createSystemDal>;

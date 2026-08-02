import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppDeps } from "../../context.js";
import { verifyWhatsappSignature } from "./whatsapp-signature.js";

const verifyQuerySchema = z.object({
  "hub.mode": z.string().optional(),
  "hub.verify_token": z.string().optional(),
  "hub.challenge": z.string().optional(),
});

const statusSchema = z
  .object({
    id: z.string(),
    status: z.string(),
    recipient_id: z.string().optional(),
    errors: z.array(z.object({ code: z.number(), title: z.string().optional() })).optional(),
  })
  .passthrough();

const messageSchema = z.object({ id: z.string(), from: z.string().optional() }).passthrough();

const eventBodySchema = z
  .object({
    object: z.string(),
    entry: z
      .array(
        z
          .object({
            changes: z
              .array(
                z
                  .object({
                    value: z
                      .object({
                        statuses: z.array(statusSchema).optional(),
                        messages: z.array(messageSchema).optional(),
                      })
                      .passthrough(),
                  })
                  .passthrough(),
              )
              .default([]),
          })
          .passthrough(),
      )
      .default([]),
  })
  .passthrough();

/**
 * WhatsApp Cloud API webhooks: GET is Meta's subscription handshake, POST
 * carries delivery statuses and inbound replies. Same discipline as telephony
 * (ADR-0004): signature verified over the raw body, then the event ledger
 * dedupes before any processing. MVP consumes delivery statuses for
 * observability; inbound-reply automations build on the same ledger later.
 */
export function registerWhatsappWebhooks(app: FastifyInstance, deps: AppDeps): void {
  const routes = app.withTypeProvider<ZodTypeProvider>();
  const { env, dal } = deps;

  routes.get(
    "/webhooks/whatsapp",
    { schema: { querystring: verifyQuerySchema } },
    async (request, reply) => {
      const q = request.query;
      const expected = env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
      if (
        q["hub.mode"] === "subscribe" &&
        expected !== undefined &&
        q["hub.verify_token"] === expected &&
        q["hub.challenge"] !== undefined
      ) {
        return reply.type("text/plain").send(q["hub.challenge"]);
      }
      return reply.status(403).send({ error: "verification failed" });
    },
  );

  routes.post("/webhooks/whatsapp", { config: { rawBody: true } }, async (request, reply) => {
    const signature = request.headers["x-hub-signature-256"];
    const rawBody = (request as { rawBody?: string | Buffer }).rawBody ?? "";
    const valid =
      env.WHATSAPP_APP_SECRET !== undefined &&
      verifyWhatsappSignature(
        env.WHATSAPP_APP_SECRET,
        rawBody,
        typeof signature === "string" ? signature : undefined,
      );
    if (!valid) {
      if (env.WEBHOOK_SIGNATURE_MODE === "log") {
        request.log.warn("WhatsApp signature invalid or unverifiable — accepted (log mode)");
      } else {
        request.log.warn("Rejected WhatsApp webhook: bad signature");
        deps.metrics.webhookSignatureFailures.inc({ provider: "whatsapp" });
        return reply.status(403).send({ error: "invalid signature" });
      }
    }

    const parsed = eventBodySchema.safeParse(request.body);
    if (!parsed.success) {
      request.log.warn("Unrecognized WhatsApp webhook shape");
      return reply.status(200).send(); // never make Meta retry unparseable noise
    }

    for (const entry of parsed.data.entry) {
      for (const change of entry.changes) {
        for (const status of change.value.statuses ?? []) {
          const { event, isNew } = await dal.system.webhooks.recordIfNew({
            provider: "whatsapp",
            eventId: `${status.id}:${status.status}`,
            eventType: `message.${status.status}`,
            payload: status,
          });
          if (!isNew) continue;
          if (status.status === "failed") {
            request.log.error(
              { messageId: status.id, errors: status.errors },
              "whatsapp message delivery failed",
            );
          }
          await dal.system.webhooks.markProcessed(event.id);
        }
        for (const message of change.value.messages ?? []) {
          const { event, isNew } = await dal.system.webhooks.recordIfNew({
            provider: "whatsapp",
            eventId: message.id,
            eventType: "message.inbound",
            payload: message,
          });
          if (!isNew) continue;
          // Inbound replies are recorded for a future reply-to-cancel flow.
          await dal.system.webhooks.markProcessed(event.id);
        }
      }
    }
    return reply.status(200).send();
  });
}

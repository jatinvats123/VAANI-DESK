import type { Logger } from "../logger.js";

/**
 * WhatsApp Cloud API client — template sends only (business-initiated
 * messages outside the 24h window must be templates). Distinguishes retryable
 * failures (throw → BullMQ backoff) from permanent ones (reported, audited,
 * not retried).
 */

export type WhatsappSendOutcome =
  { ok: true; messageId: string | undefined } | { ok: false; retryable: boolean; error: string };

export interface WhatsappTemplateMessage {
  /** E.164 without "+" is accepted by the API; we pass E.164 as-is. */
  to: string;
  templateName: string;
  languageCode: string;
  /** Positional {{1}}..{{n}} body parameters. */
  bodyParams: string[];
}

export interface WhatsappClient {
  readonly configured: boolean;
  sendTemplate(message: WhatsappTemplateMessage): Promise<WhatsappSendOutcome>;
}

export interface WhatsappClientConfig {
  phoneNumberId: string | undefined;
  accessToken: string | undefined;
  graphVersion: string;
}

export function createWhatsappClient(config: WhatsappClientConfig, log: Logger): WhatsappClient {
  const { phoneNumberId, accessToken } = config;
  if (!phoneNumberId || !accessToken) {
    log.warn("WhatsApp credentials not configured — notification jobs will be skipped");
    return {
      configured: false,
      sendTemplate: () =>
        Promise.resolve({ ok: false, retryable: false, error: "whatsapp_not_configured" }),
    };
  }

  const url = `https://graph.facebook.com/${config.graphVersion}/${phoneNumberId}/messages`;

  return {
    configured: true,
    async sendTemplate(message: WhatsappTemplateMessage): Promise<WhatsappSendOutcome> {
      let response: Response;
      try {
        response = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: message.to,
            type: "template",
            template: {
              name: message.templateName,
              language: { code: message.languageCode },
              components: [
                {
                  type: "body",
                  parameters: message.bodyParams.map((text) => ({ type: "text", text })),
                },
              ],
            },
          }),
          signal: AbortSignal.timeout(15_000),
        });
      } catch (error) {
        return {
          ok: false,
          retryable: true,
          error: error instanceof Error ? error.message : "network error",
        };
      }

      const body = (await response.json().catch(() => undefined)) as
        | { messages?: Array<{ id?: string }>; error?: { message?: string; code?: number } }
        | undefined;

      if (response.ok) {
        return { ok: true, messageId: body?.messages?.[0]?.id };
      }
      const detail = body?.error?.message ?? `HTTP ${response.status}`;
      // 429 + 5xx are transient; 4xx (bad template, invalid number) won't heal.
      const retryable = response.status === 429 || response.status >= 500;
      return {
        ok: false,
        retryable,
        error: `${detail} (code ${body?.error?.code ?? response.status})`,
      };
    },
  };
}

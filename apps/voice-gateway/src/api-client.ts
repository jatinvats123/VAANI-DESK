import { injectTraceContext, type Context } from "@vaanidesk/observability";
import type { BusinessHours, PromptConfig } from "@vaanidesk/shared";
import type {
  CallCostBreakdown,
  CallLatencyRollup,
  CallOutcome,
  TelephonyProvider,
  TokenUsage,
  ToolCallRecord,
  TurnMetrics,
  TurnRole,
} from "@vaanidesk/core";

/**
 * Typed client for the api's /v1/internal/* surface (service-token auth).
 * Tool methods return the error envelope instead of throwing — a failed tool
 * becomes a structured tool_result the LLM can react to, not an exception in
 * the audio path.
 */

export interface CallContextResponse {
  call: { id: string; businessId: string; fromNumber: string };
  business: {
    id: string;
    name: string;
    timezone: string;
    hours: BusinessHours;
    promptConfig: PromptConfig;
    ownerPhone: string | null;
    policy: {
      slotGranularityMin: number;
      bookingBufferMin: number;
      minNoticeMin: number;
      maxAdvanceDays: number;
    };
  };
  services: Array<{
    id: string;
    name: string;
    description: string | null;
    durationMin: number;
    pricePaise: number;
    priceDisplay: string;
  }>;
}

export interface ApiEnvelopeError {
  code: string;
  message: string;
  details?: unknown;
}

export type ToolApiResult = { ok: true; data: unknown } | { ok: false; error: ApiEnvelopeError };

export interface AppendTurnBody {
  businessId: string;
  turnIndex: number;
  role: TurnRole;
  text?: string | null;
  toolCalls?: ToolCallRecord[];
  startedAt?: string;
  endedAt?: string;
  metrics?: TurnMetrics;
}

export interface CompleteCallBody {
  businessId: string;
  status: "completed" | "failed";
  endedAt: string;
  durationSec?: number;
  outcome?: CallOutcome;
  language?: string;
  latencyRollup?: CallLatencyRollup;
  costBreakdown?: CallCostBreakdown;
  totalCostPaise?: number;
  tokenUsage?: TokenUsage;
}

export class InternalApiError extends Error {
  constructor(
    readonly status: number,
    readonly envelope: ApiEnvelopeError,
  ) {
    super(`${envelope.code}: ${envelope.message}`);
    this.name = "InternalApiError";
  }
}

export class InternalApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly serviceSecret: string,
    private readonly timeoutMs = 10_000,
    /** When set, requests inject this trace context so the call is one trace. */
    private readonly traceContext?: Context,
  ) {}

  /** A client bound to a call's trace context — every request joins that trace. */
  withTraceContext(ctx: Context): InternalApiClient {
    return new InternalApiClient(this.baseUrl, this.serviceSecret, this.timeoutMs, ctx);
  }

  async getCallContext(
    provider: TelephonyProvider,
    providerCallId: string,
  ): Promise<CallContextResponse> {
    return (await this.request(
      "GET",
      `/v1/internal/calls/${provider}/${encodeURIComponent(providerCallId)}/context`,
    )) as CallContextResponse;
  }

  async markAnswered(callId: string, businessId: string): Promise<void> {
    await this.request("POST", `/v1/internal/calls/${callId}/answered`, { businessId });
  }

  async appendTurn(callId: string, body: AppendTurnBody): Promise<void> {
    await this.request("POST", `/v1/internal/calls/${callId}/turns`, body);
  }

  async completeCall(callId: string, body: CompleteCallBody): Promise<void> {
    await this.request("POST", `/v1/internal/calls/${callId}/complete`, body);
  }

  async transferCall(callId: string, businessId: string, reason?: string): Promise<ToolApiResult> {
    return await this.toolRequest(`/v1/internal/calls/${callId}/transfer`, {
      businessId,
      ...(reason !== undefined ? { reason } : {}),
    });
  }

  async checkAvailability(body: {
    businessId: string;
    serviceId: string;
    date: string;
    maxSlots?: number;
  }): Promise<ToolApiResult> {
    return await this.toolRequest("/v1/internal/tools/check_availability", body);
  }

  async createBooking(body: {
    businessId: string;
    callId: string;
    serviceId: string;
    startsAt: string;
    customerName: string;
    customerPhone: string;
    idempotencyKey: string;
  }): Promise<ToolApiResult> {
    return await this.toolRequest("/v1/internal/tools/create_booking", body);
  }

  async cancelBooking(body: {
    businessId: string;
    callId: string;
    customerPhone: string;
    bookingId?: string;
    reason?: string;
  }): Promise<ToolApiResult> {
    return await this.toolRequest("/v1/internal/tools/cancel_booking", body);
  }

  /** Throws InternalApiError on any non-2xx — for lifecycle calls. */
  private async request(method: string, path: string, body?: unknown): Promise<unknown> {
    const result = await this.rawRequest(method, path, body);
    if (!result.ok) throw new InternalApiError(result.status, result.error);
    return result.data;
  }

  /** Never throws on HTTP errors — for agent tools. */
  private async toolRequest(path: string, body: unknown): Promise<ToolApiResult> {
    try {
      const result = await this.rawRequest("POST", path, body);
      return result.ok ? { ok: true, data: result.data } : { ok: false, error: result.error };
    } catch (error) {
      return {
        ok: false,
        error: {
          code: "service_unavailable",
          message: error instanceof Error ? error.message : "api unreachable",
        },
      };
    }
  }

  private async rawRequest(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<
    | { ok: true; status: number; data: unknown }
    | { ok: false; status: number; error: ApiEnvelopeError }
  > {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.serviceSecret}`,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        // Empty object when tracing is disabled — no headers added.
        ...injectTraceContext({}, this.traceContext),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    const json = (await response.json().catch(() => undefined)) as
      { error?: ApiEnvelopeError } | undefined;

    if (response.ok) {
      return { ok: true, status: response.status, data: json };
    }
    return {
      ok: false,
      status: response.status,
      error: json?.error ?? { code: "internal_error", message: `HTTP ${response.status}` },
    };
  }
}

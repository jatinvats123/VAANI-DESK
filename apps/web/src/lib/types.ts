import type { BusinessHours, PromptConfig } from "@vaanidesk/shared";
import type {
  BookingSource,
  BookingStatus,
  CallLatencyRollup,
  CallOutcome,
  CallStatus,
  MembershipRole,
  ToolCallRecord,
  TurnMetrics,
  TurnRole,
} from "@vaanidesk/core";

/** Wire shapes of /v1 responses (mirrors the api's DTO mappers). */

export interface MeResponse {
  user: { id: string; name: string | null; email: string; image: string | null };
  businesses: Array<{
    id: string;
    name: string;
    slug: string;
    role: MembershipRole;
    onboarded: boolean;
  }>;
}

export interface BusinessDto {
  id: string;
  name: string;
  slug: string;
  phoneNumber: string | null;
  ownerPhone: string | null;
  notificationPhone: string | null;
  timezone: string;
  hours: BusinessHours;
  promptConfig: PromptConfig;
  policy: {
    slotGranularityMin: number;
    bookingBufferMin: number;
    minNoticeMin: number;
    maxAdvanceDays: number;
  };
  onboardedAt: string | null;
  createdAt: string;
}

export interface ServiceDto {
  id: string;
  name: string;
  description: string | null;
  durationMin: number;
  pricePaise: number;
  active: boolean;
  sortOrder: number;
}

export interface BookingDto {
  id: string;
  serviceId: string;
  service?: ServiceDto;
  callId: string | null;
  customerName: string;
  customerPhone: string;
  startsAt: string;
  endsAt: string;
  status: BookingStatus;
  source: BookingSource;
  pricePaise: number;
  notes: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  createdAt: string;
}

export interface CallDto {
  id: string;
  provider: string;
  direction: string;
  status: CallStatus;
  fromNumber: string;
  toNumber: string;
  language: string | null;
  startedAt: string;
  answeredAt: string | null;
  endedAt: string | null;
  durationSec: number | null;
  outcome: CallOutcome | null;
  hasRecording: boolean;
  totalCostPaise: number | null;
  latencyRollup: CallLatencyRollup | null;
}

export interface CallTurnDto {
  id: string;
  turnIndex: number;
  role: TurnRole;
  text: string | null;
  toolCalls: ToolCallRecord[] | null;
  startedAt: string | null;
  endedAt: string | null;
  metrics: TurnMetrics | null;
}

export interface AnalyticsResponse {
  days: number;
  from: string;
  to: string;
  calls: {
    total: number;
    answered: number;
    totalCostPaise: number;
    byOutcome: Record<string, number>;
  };
  bookings: {
    created: number;
    voiceCreated: number;
    voiceRevenuePaise: number;
  };
  daily: Array<{
    date: string;
    calls: number;
    bookings: number;
    voiceRevenuePaise: number;
  }>;
}

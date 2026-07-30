import type { Booking, Business, Call, CallTurn, Resource, Service } from "@vaanidesk/db";

/**
 * Wire shapes for /v1 responses: dates become ISO strings, tenant-internal
 * fields stay out. Mappers are the only path from DB rows to JSON.
 */

export function toBusinessDto(business: Business) {
  return {
    id: business.id,
    name: business.name,
    slug: business.slug,
    phoneNumber: business.phoneNumber,
    ownerPhone: business.ownerPhone,
    notificationPhone: business.notificationPhone,
    timezone: business.timezone,
    hours: business.hours,
    promptConfig: business.promptConfig,
    policy: {
      slotGranularityMin: business.slotGranularityMin,
      bookingBufferMin: business.bookingBufferMin,
      minNoticeMin: business.minNoticeMin,
      maxAdvanceDays: business.maxAdvanceDays,
    },
    onboardedAt: business.onboardedAt?.toISOString() ?? null,
    createdAt: business.createdAt.toISOString(),
  };
}

export function toServiceDto(service: Service) {
  return {
    id: service.id,
    name: service.name,
    description: service.description,
    durationMin: service.durationMin,
    pricePaise: service.pricePaise,
    active: service.active,
    sortOrder: service.sortOrder,
  };
}

export function toResourceDto(resource: Resource) {
  return {
    id: resource.id,
    name: resource.name,
    type: resource.type,
    active: resource.active,
  };
}

export function toBookingDto(
  booking: Booking,
  related: { service?: Service | null; resource?: Resource | null } = {},
) {
  return {
    id: booking.id,
    serviceId: booking.serviceId,
    service: related.service ? toServiceDto(related.service) : undefined,
    resource: related.resource ? toResourceDto(related.resource) : undefined,
    callId: booking.callId,
    customerName: booking.customerName,
    customerPhone: booking.customerPhone,
    startsAt: booking.startsAt.toISOString(),
    endsAt: booking.endsAt.toISOString(),
    status: booking.status,
    source: booking.source,
    pricePaise: booking.pricePaise,
    notes: booking.notes,
    cancelledAt: booking.cancelledAt?.toISOString() ?? null,
    cancellationReason: booking.cancellationReason,
    createdAt: booking.createdAt.toISOString(),
  };
}

export function toCallDto(call: Call) {
  return {
    id: call.id,
    provider: call.provider,
    direction: call.direction,
    status: call.status,
    fromNumber: call.fromNumber,
    toNumber: call.toNumber,
    language: call.language,
    startedAt: call.startedAt.toISOString(),
    answeredAt: call.answeredAt?.toISOString() ?? null,
    endedAt: call.endedAt?.toISOString() ?? null,
    durationSec: call.durationSec,
    outcome: call.outcome,
    hasRecording: call.recordingKey != null,
    totalCostPaise: call.totalCostPaise,
    latencyRollup: call.latencyRollup,
  };
}

export function toCallTurnDto(turn: CallTurn) {
  return {
    id: turn.id,
    turnIndex: turn.turnIndex,
    role: turn.role,
    text: turn.text,
    toolCalls: turn.toolCalls,
    startedAt: turn.startedAt?.toISOString() ?? null,
    endedAt: turn.endedAt?.toISOString() ?? null,
    metrics: turn.metrics,
  };
}

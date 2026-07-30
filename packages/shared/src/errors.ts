import { z } from "zod";

/**
 * Application-wide error taxonomy. Every error that crosses a service boundary
 * (HTTP response, tool result to the LLM, queue job failure) is an AppError with
 * one of these codes; the HTTP layer maps codes to status codes in one place.
 */
export const APP_ERROR_CODES = [
  "validation_error",
  "unauthorized",
  "forbidden",
  "not_found",
  "conflict",
  "slot_unavailable",
  "rate_limited",
  "payload_too_large",
  "internal_error",
  "service_unavailable",
] as const;

export type AppErrorCode = (typeof APP_ERROR_CODES)[number];

const STATUS_BY_CODE: Record<AppErrorCode, number> = {
  validation_error: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  slot_unavailable: 409,
  rate_limited: 429,
  payload_too_large: 413,
  internal_error: 500,
  service_unavailable: 503,
};

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly statusCode: number;
  readonly details: unknown;

  constructor(
    code: AppErrorCode,
    message: string,
    options?: { details?: unknown; cause?: unknown },
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "AppError";
    this.code = code;
    this.statusCode = STATUS_BY_CODE[code];
    this.details = options?.details;
  }

  static validation(message: string, details?: unknown): AppError {
    return new AppError("validation_error", message, { details });
  }

  static unauthorized(message = "Authentication required"): AppError {
    return new AppError("unauthorized", message);
  }

  static forbidden(message = "You do not have access to this resource"): AppError {
    return new AppError("forbidden", message);
  }

  static notFound(resource: string, id?: string): AppError {
    return new AppError("not_found", id ? `${resource} ${id} not found` : `${resource} not found`);
  }

  static conflict(message: string, details?: unknown): AppError {
    return new AppError("conflict", message, { details });
  }

  static slotUnavailable(message: string, details?: unknown): AppError {
    return new AppError("slot_unavailable", message, { details });
  }

  static internal(message = "Internal error", cause?: unknown): AppError {
    return new AppError("internal_error", message, { cause });
  }
}

/** Typed error envelope returned by every /v1 endpoint on failure. */
export const errorEnvelopeSchema = z.object({
  error: z.object({
    code: z.enum(APP_ERROR_CODES),
    message: z.string(),
    details: z.unknown().optional(),
    requestId: z.string().optional(),
  }),
});

export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;

export function toErrorEnvelope(error: unknown, requestId?: string): ErrorEnvelope {
  if (error instanceof AppError) {
    return {
      error: {
        code: error.code,
        message: error.message,
        ...(error.details !== undefined ? { details: error.details } : {}),
        ...(requestId !== undefined ? { requestId } : {}),
      },
    };
  }
  // Never leak internals of unexpected errors to clients.
  return {
    error: {
      code: "internal_error",
      message: "Something went wrong",
      ...(requestId !== undefined ? { requestId } : {}),
    },
  };
}

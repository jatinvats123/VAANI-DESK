import { Sentry } from "@vaanidesk/observability";
import { AppError, toErrorEnvelope } from "@vaanidesk/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
} from "fastify-type-provider-zod";

/**
 * One place maps every failure to the typed error envelope. Handlers throw
 * AppError (or return Results the routes convert); nothing else ever reaches
 * the wire.
 */
export function registerErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    const requestId = request.id;

    if (error instanceof AppError) {
      if (error.statusCode >= 500) {
        request.log.error({ err: error, code: error.code }, error.message);
        captureServerError(error, request);
      }
      return reply.status(error.statusCode).send(toErrorEnvelope(error, requestId));
    }

    if (hasZodFastifySchemaValidationErrors(error)) {
      const details = error.validation.map((issue) => ({
        path: issue.params.issue.path.join("."),
        message: issue.params.issue.message,
      }));
      return reply
        .status(400)
        .send(
          toErrorEnvelope(AppError.validation("Request failed validation", details), requestId),
        );
    }

    if (isResponseSerializationError(error)) {
      request.log.error({ err: error }, "Response failed schema serialization");
      captureServerError(error, request);
      return reply.status(500).send(toErrorEnvelope(error, requestId));
    }

    // Fastify's own errors (body limits, unsupported media type, …) carry statusCode.
    const statusCode = extractStatusCode(error);
    if (statusCode >= 500) {
      request.log.error({ err: error }, "Unhandled error");
      captureServerError(error, request);
      return reply.status(statusCode).send(toErrorEnvelope(error, requestId));
    }
    const message = error instanceof Error && error.message ? error.message : "Bad request";
    return reply
      .status(statusCode)
      .send(toErrorEnvelope(new AppError("validation_error", message), requestId));
  });

  // Server-side (5xx) failures go to Sentry. No-op when SENTRY_DSN is unset;
  // the event is PII-scrubbed by initSentry's beforeSend. Route template (not
  // the raw path) avoids leaking ids into the Sentry tag.
  function captureServerError(error: unknown, request: FastifyRequest): void {
    Sentry.captureException(error, {
      tags: { route: request.routeOptions.url ?? "unknown", method: request.method },
      extra: { requestId: request.id },
    });
  }

  function extractStatusCode(error: unknown): number {
    if (typeof error === "object" && error !== null && "statusCode" in error) {
      const statusCode = (error as { statusCode?: unknown }).statusCode;
      if (typeof statusCode === "number" && statusCode >= 400 && statusCode <= 599) {
        return statusCode;
      }
    }
    return 500;
  }

  app.setNotFoundHandler((request, reply) => {
    void reply
      .status(404)
      .send(
        toErrorEnvelope(AppError.notFound(`Route ${request.method} ${request.url}`), request.id),
      );
  });
}

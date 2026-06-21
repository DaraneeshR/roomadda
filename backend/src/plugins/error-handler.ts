import fp from "fastify-plugin";
import type { FastifyError } from "fastify";
import { ZodError } from "zod";
import { InvalidMoneyError } from "../lib/money.js";
import { AppError } from "../lib/errors.js";
import { isDevelopment } from "../config/env.js";

/**
 * Global error + not-found handling.
 *
 * Clients always get a sanitized `{ error: { code, message, requestId } }`
 * envelope. Full error detail (and stack) goes to logs only — no stack traces
 * ever leak to clients, and 5xx messages are generic in every environment.
 */
interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    requestId: string;
    details?: unknown;
  };
}

export const errorHandlerPlugin = fp(
  function errorHandler(app, _opts, done) {
    app.setNotFoundHandler((request, reply) => {
      const body: ErrorEnvelope = {
        error: {
          code: "NOT_FOUND",
          message: `Route ${request.method} ${request.url} not found`,
          requestId: request.id,
        },
      };
      reply.status(404).send(body);
    });

    app.setErrorHandler((error: FastifyError, request, reply) => {
      // 1) zod validation at a service/route boundary -> 400 with safe issues.
      if (error instanceof ZodError) {
        request.log.info({ issues: error.issues }, "request validation failed");
        const body: ErrorEnvelope = {
          error: {
            code: "VALIDATION_ERROR",
            message: "Request validation failed",
            requestId: request.id,
            details: error.issues.map((issue) => ({
              path: issue.path.join("."),
              message: issue.message,
            })),
          },
        };
        return reply.status(400).send(body);
      }

      // 1b) Invalid money (failed assertPaise) is a client error.
      if (error instanceof InvalidMoneyError) {
        request.log.info({ err: error }, "invalid money amount");
        const body: ErrorEnvelope = {
          error: {
            code: "INVALID_AMOUNT",
            message: error.message,
            requestId: request.id,
          },
        };
        return reply.status(400).send(body);
      }

      // 2) Typed application errors carry their own status + code.
      if (error instanceof AppError) {
        request.log.warn({ err: error, code: error.code }, error.message);
        const body: ErrorEnvelope = {
          error: {
            code: error.code,
            message: error.expose ? error.message : "Something went wrong",
            requestId: request.id,
            ...(error.expose && error.details !== undefined
              ? { details: error.details }
              : {}),
          },
        };
        return reply.status(error.statusCode).send(body);
      }

      // 3) Fastify's built-in schema validation -> 400.
      if (error.validation) {
        const body: ErrorEnvelope = {
          error: {
            code: "VALIDATION_ERROR",
            message: "Request validation failed",
            requestId: request.id,
            details: error.validation,
          },
        };
        return reply.status(400).send(body);
      }

      const statusCode = error.statusCode ?? 500;

      // 4) Known client-side errors (e.g. 429 from the rate limiter) pass through.
      if (statusCode < 500) {
        request.log.warn({ err: error }, error.message);
        const body: ErrorEnvelope = {
          error: {
            code: error.code ?? "ERROR",
            message: error.message,
            requestId: request.id,
          },
        };
        return reply.status(statusCode).send(body);
      }

      // 5) Anything else is unexpected -> 500. Full detail to logs only.
      request.log.error({ err: error }, "unhandled error");
      const body: ErrorEnvelope = {
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "Internal server error",
          requestId: request.id,
          ...(isDevelopment ? { details: error.message } : {}),
        },
      };
      return reply.status(500).send(body);
    });

    done();
  },
  { name: "error-handler" },
);

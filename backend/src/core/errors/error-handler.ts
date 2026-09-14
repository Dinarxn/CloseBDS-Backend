import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ApiError } from './api-error.js';
import { ZodError } from 'zod';

export interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId?: string;
  };
}

/**
 * Centralized Fastify error handler.
 * Ensures internal errors, stack traces, and environment secrets are never leaked to clients.
 */
export function fastifyErrorHandler(
  error: FastifyError | ApiError | Error,
  request: FastifyRequest,
  reply: FastifyReply
): void {
  const requestId = request.id;

  // Handle custom application ApiErrors
  if (error instanceof ApiError) {
    if (error.statusCode >= 500) {
      request.log.error({ err: error, requestId }, `Server Error: ${error.message}`);
    } else {
      request.log.warn({ err: error, requestId }, `Client Error: ${error.message}`);
    }

    const responsePayload: ErrorResponse = {
      error: {
        code: error.code,
        message: error.message,
        details: error.details,
        requestId,
      },
    };

    reply.status(error.statusCode).send(responsePayload);
    return;
  }

  // Handle Zod validation errors
  if (error instanceof ZodError) {
    request.log.warn({ err: error, requestId }, 'Validation Error');

    const formattedIssues = error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
      code: issue.code,
    }));

    const responsePayload: ErrorResponse = {
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid request payload or parameters',
        details: formattedIssues,
        requestId,
      },
    };

    reply.status(400).send(responsePayload);
    return;
  }

  // Handle standard Fastify errors (e.g. 404, 400, FST_ERR_*)
  const fastifyErr = error as FastifyError;
  if (fastifyErr.statusCode && fastifyErr.statusCode < 500) {
    request.log.warn({ err: fastifyErr, requestId }, `Fastify Client Error: ${fastifyErr.message}`);

    const responsePayload: ErrorResponse = {
      error: {
        code: fastifyErr.code || 'BAD_REQUEST',
        message: fastifyErr.message,
        requestId,
      },
    };

    reply.status(fastifyErr.statusCode).send(responsePayload);
    return;
  }

  // Handle database connection / unreachable errors
  if (
    error.name === 'PrismaClientInitializationError' ||
    (error instanceof Error && error.message.includes("Can't reach database server"))
  ) {
    request.log.error({ err: error, requestId }, 'Database Connection Error');
    const isProduction = process.env.NODE_ENV === 'production';
    const message = isProduction
      ? 'Database service is temporarily unavailable.'
      : 'Cannot reach PostgreSQL database server. Please verify PostgreSQL is running at localhost:5432 or configure DATABASE_URL.';

    reply.status(503).send({
      error: {
        code: 'DATABASE_UNAVAILABLE',
        message,
        requestId,
      },
    });
    return;
  }

  // Handle all other unexpected internal errors (HTTP 500)
  request.log.error({ err: error, requestId }, 'Unhandled Internal Server Error');

  const responsePayload: ErrorResponse = {
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected internal error occurred. Please try again later.',
      requestId,
    },
  };

  reply.status(500).send(responsePayload);
}

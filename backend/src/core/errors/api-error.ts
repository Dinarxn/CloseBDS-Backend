/**
 * Base Application API Error with status code, machine-readable code, and safe client messaging.
 */
export class ApiError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: unknown;
  public readonly isOperational: boolean;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    details?: unknown,
    isOperational = true
  ) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = isOperational;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class BadRequestError extends ApiError {
  constructor(message = 'Bad Request', details?: unknown, code = 'BAD_REQUEST') {
    super(400, code, message, details);
  }
}

export class ValidationError extends ApiError {
  constructor(message = 'Validation Failed', details?: unknown) {
    super(400, 'VALIDATION_ERROR', message, details);
  }
}

export class UnauthorizedError extends ApiError {
  constructor(message = 'Unauthorized', details?: unknown) {
    super(401, 'UNAUTHORIZED', message, details);
  }
}

export class ForbiddenError extends ApiError {
  constructor(message = 'Forbidden', details?: unknown) {
    super(403, 'FORBIDDEN', message, details);
  }
}

export class NotFoundError extends ApiError {
  constructor(message = 'Resource Not Found', details?: unknown) {
    super(404, 'NOT_FOUND', message, details);
  }
}

export class ConflictError extends ApiError {
  constructor(message = 'Resource Conflict', details?: unknown) {
    super(409, 'CONFLICT', message, details);
  }
}

export class RateLimitError extends ApiError {
  constructor(message = 'Too Many Requests', details?: unknown) {
    super(429, 'RATE_LIMIT_EXCEEDED', message, details);
  }
}

export class PermissionGatedError extends ApiError {
  constructor(message = 'Human Approval Required before execution', details?: unknown) {
    super(403, 'PERMISSION_GATE_REQUIRED', message, details);
  }
}

export class KillSwitchActiveError extends ApiError {
  constructor(message = 'Global Outreach Kill Switch is active', details?: unknown) {
    super(503, 'KILL_SWITCH_ACTIVE', message, details);
  }
}

export class InternalServerError extends ApiError {
  constructor(message = 'Internal Server Error', details?: unknown) {
    super(500, 'INTERNAL_SERVER_ERROR', message, details, false);
  }
}

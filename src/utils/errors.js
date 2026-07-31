/**
 * Application error hierarchy.
 *
 * Every error raised inside the service layer should be (or wrap) an
 * AppError so the central error handler can map it to a proper HTTP
 * status code without leaking internal details.
 */

export class AppError extends Error {
  /**
   * @param {string} message - human readable description
   * @param {number} [statusCode=500] - HTTP status code
   * @param {object} [details] - optional machine-readable details
   * @param {boolean} [isOperational=true] - expected error vs programming bug
   */
  constructor(message, statusCode = 500, details = undefined, isOperational = true) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.details = details;
    this.isOperational = isOperational;
    Error.captureStackTrace?.(this, this.constructor);
  }

  toJSON() {
    return {
      error: this.name,
      message: this.message,
      ...(this.details ? { details: this.details } : {}),
    };
  }
}

export class BadRequestError extends AppError {
  constructor(message = 'Bad request', details) {
    super(message, 400, details);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Not found', details) {
    super(message, 404, details);
  }
}

export class UnprocessableEntityError extends AppError {
  constructor(message = 'Unprocessable entity', details) {
    super(message, 422, details);
  }
}

/** Raised when an upstream provider (e.g. Open-Meteo) fails. */
export class ExternalServiceError extends AppError {
  constructor(message = 'Upstream service error', details) {
    super(message, 502, details);
  }
}

export class GatewayTimeoutError extends AppError {
  constructor(message = 'Upstream service timed out', details) {
    super(message, 504, details);
  }
}

/** Normalize any thrown value into an AppError (preserving status codes). */
export function toAppError(err) {
  if (err instanceof AppError) return err;
  return new AppError(err?.message || 'Internal server error', 500, undefined, false);
}

import { toAppError } from '../utils/errors.js';
import logger from '../utils/logger.js';

/**
 * 404 handler for unknown routes.
 */
export function notFoundHandler(req, res) {
  res.status(404).json({
    error: 'NotFoundError',
    message: `Route ${req.method} ${req.originalUrl} not found`,
  });
}

/**
 * Central error handler.
 *
 * Converts any thrown error into a JSON response with the proper HTTP
 * status code. Operational errors (AppError) keep their message; unknown
 * errors are logged and returned as a generic 500 without internal details.
 */
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  const appError = toAppError(err);
  const log = req.log ?? logger;

  if (appError.statusCode >= 500) {
    log.error(`[error] ${appError.message}`, {
      errorName: appError.name,
      stack: appError.stack,
      path: req.originalUrl,
    });
  } else {
    log.warn(`[error] ${appError.message}`, {
      errorName: appError.name,
      path: req.originalUrl,
    });
  }

  const body = appError.toJSON();
  // Never leak internal details for genuine server errors, but do keep the
  // safe upstream messages of gateway errors (502/504).
  if (appError.statusCode === 500) {
    body.message = 'Internal server error';
  }
  res.status(appError.statusCode).json(body);
}

export default errorHandler;

import crypto from 'node:crypto';
import logger from '../utils/logger.js';

/**
 * Request logging middleware.
 *
 * Assigns a request id, logs every incoming request with its duration, and
 * attaches the id (and a child logger) to the request so downstream log
 * lines can be correlated.
 */
export function requestLogger(req, res, next) {
  const requestId = req.headers['x-request-id'] || crypto.randomUUID();
  const startedAt = process.hrtime.bigint();

  req.requestId = requestId;
  req.log = logger.child(requestId);

  res.setHeader('x-request-id', requestId);

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    req.log.info('request completed', {
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      durationMs: Math.round(durationMs),
      ip: req.ip,
    });
  });

  next();
}

export default requestLogger;

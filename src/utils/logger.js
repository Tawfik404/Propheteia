import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import env from '../config/env.js';

const LEVELS = Object.freeze({ debug: 10, info: 20, warn: 30, error: 40 });

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let fileStream = null;
if (env.logFile) {
  const logPath = path.isAbsolute(env.logFile)
    ? env.logFile
    : path.resolve(__dirname, '../../', env.logFile);
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fileStream = fs.createWriteStream(logPath, { flags: 'a' });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[logger] unable to open log file "${env.logFile}": ${err.message}`);
  }
}

/**
 * Minimal structured logger.
 *
 * Writes JSON lines to stdout (and optionally a log file). A `requestId`
 * can be bound per-request so logs from a single HTTP request can be
 * correlated.
 */
class Logger {
  constructor() {
    this.minLevel = LEVELS[env.logLevel] ?? LEVELS.info;
  }

  /**
   * @param {string} level - one of 'debug' | 'info' | 'warn' | 'error'
   * @param {string} message
   * @param {object} [meta] - extra structured fields
   * @param {string} [requestId]
   */
  log(level, message, meta = {}, requestId = '') {
    if (LEVELS[level] < this.minLevel) return;

    const entry = {
      level,
      timestamp: new Date().toISOString(),
      message,
      ...meta,
    };
    if (requestId) entry.requestId = requestId;

    const line = JSON.stringify(entry);
    // eslint-disable-next-line no-console
    console[level === 'error' ? 'error' : 'log'](line);
    if (fileStream) fileStream.write(`${line}\n`);
  }

  debug(message, meta, requestId) {
    this.log('debug', message, meta, requestId);
  }

  info(message, meta, requestId) {
    this.log('info', message, meta, requestId);
  }

  warn(message, meta, requestId) {
    this.log('warn', message, meta, requestId);
  }

  error(message, meta, requestId) {
    this.log('error', message, meta, requestId);
  }

  /** Create a child logger with a fixed request id bound. */
  child(requestId) {
    const logger = this;
    return {
      debug: (m, meta = {}) => logger.debug(m, meta, requestId),
      info: (m, meta = {}) => logger.info(m, meta, requestId),
      warn: (m, meta = {}) => logger.warn(m, meta, requestId),
      error: (m, meta = {}) => logger.error(m, meta, requestId),
    };
  }
}

const logger = new Logger();
export default logger;

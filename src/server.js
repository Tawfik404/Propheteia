import http from 'node:http';
import env from './config/env.js';
import logger from './utils/logger.js';
import { getDatabase, closeDatabase } from './db/database.js';
import { seedIfEmpty } from './db/seed.js';
import { scheduler } from './jobs/scheduler.js';
import { initSocket, closeSocket } from './socket/index.js';
import { createApp } from './app.js';

/**
 * HTTP server entry point.
 *
 * Boot order:
 *   1. initialise the SQLite database (FWI recursive state),
 *   2. seed the monitored locations on first boot (background predictions),
 *   3. start the background job scheduler,
 *   4. start the HTTP server with the real-time (Socket.IO) layer,
 *   5. handle graceful shutdown on SIGINT/SIGTERM.
 */
const app = createApp();

// 1. Database (also creates the data directory).
getDatabase();

// 2. Seed monitored locations + initial predictions (non-blocking).
seedIfEmpty();

// 3. Background jobs.
if (env.jobsEnabled) {
  scheduler.start();
} else {
  logger.warn('[server] background jobs disabled (JOBS_ENABLED=false)');
}

// 4. HTTP server shared with the Socket.IO transport.
const server = http.createServer(app);
initSocket(server);

server.listen(env.port, env.host, () => {
  logger.info(`[server] propheteia-backend listening on http://${env.host}:${env.port}`);
  logger.info(`[server] environment: ${env.nodeEnv}`);
});

// 5. Graceful shutdown.
let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`[server] received ${signal}, shutting down...`);

  closeSocket();
  server.close(() => {
    scheduler.stop();
    closeDatabase();
    logger.info('[server] shutdown complete');
    process.exit(0);
  });

  // Safety net: force exit if graceful shutdown hangs.
  setTimeout(() => {
    logger.warn('[server] forced shutdown after timeout');
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (reason) => {
  logger.error('[server] unhandled rejection', { reason: String(reason) });
});
process.on('uncaughtException', (err) => {
  logger.error('[server] uncaught exception', { error: err.message, stack: err.stack });
  shutdown('uncaughtException');
});

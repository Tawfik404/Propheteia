import express from 'express';
import routes from './routes/index.js';
import { requestLogger } from './middleware/requestLogger.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import env from './config/env.js';

/**
 * Express application factory.
 *
 * Kept separate from the HTTP server so the app can be tested without
 * binding a port (e.g. supertest) and the server can manage its own
 * lifecycle (start/stop/graceful shutdown).
 */
export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.set('jobsEnabled', env.jobsEnabled);

  // Parse JSON bodies (needed by POST /api/locations).
  app.use(express.json({ limit: '64kb' }));

  // Structured request logging with request ids.
  app.use(requestLogger);

  // Health check at the bare root as well, for load balancers.
  app.get('/', (req, res) => {
    res.json({ service: 'propheteia-backend', status: 'ok', docs: '/api/health' });
  });

  // API routes.
  app.use('/api', routes);

  // 404 for unknown routes, then the central error handler.
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

export default createApp;

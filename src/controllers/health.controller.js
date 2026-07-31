import { asyncHandler } from '../utils/asyncHandler.js';
import { validateCoordinates } from '../utils/geo.js';
import LocationStore from '../db/locationStore.js';
import { cacheStore } from '../cache/index.js';
import { getDatabase } from '../db/database.js';

/**
 * GET /api/health
 *
 * Lightweight health probe: server status, uptime, cache statistics and
 * database connectivity.
 */
export const getHealth = asyncHandler(async (req, res) => {
  let dbStatus = 'ok';
  try {
    getDatabase().prepare('SELECT 1').get();
  } catch {
    dbStatus = 'error';
  }

  res.json({
    status: dbStatus === 'ok' ? 'ok' : 'degraded',
    service: 'propheteia-backend',
    version: process.env.npm_package_version || '1.0.0',
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
    database: dbStatus,
    cache: {
      backend: cacheStore.backend,
      stats: cacheStore.stats(),
    },
    jobs: req.app.get('jobsEnabled') === true ? 'enabled' : 'disabled',
  });
});

/**
 * GET /api/locations
 *
 * List the locations currently monitored by the background jobs.
 */
export const listLocations = asyncHandler(async (req, res) => {
  const store = new LocationStore();
  res.json({ count: store.list().length, locations: store.list() });
});

/**
 * POST /api/locations  { "lat": .., "lon": .., "name": "..." }
 *
 * Register a location to be monitored by the background jobs.
 */
export const registerLocation = asyncHandler(async (req, res) => {
  const { lat, lon } = validateCoordinates(req.body?.lat, req.body?.lon);
  const name = typeof req.body?.name === 'string' ? req.body.name.slice(0, 200) : null;

  const store = new LocationStore();
  const result = store.register(lat, lon, name);

  res.status(result.inserted ? 201 : 200).json(result);
});

/**
 * DELETE /api/locations?lat=..&lon=..
 *
 * Remove a location from the monitored set.
 */
export const unregisterLocation = asyncHandler(async (req, res) => {
  const { lat, lon } = validateCoordinates(req.query.lat, req.query.lon);
  const store = new LocationStore();

  if (!store.unregister(lat, lon)) {
    res.status(404).json({ error: 'NotFoundError', message: 'Location is not monitored' });
    return;
  }
  res.json({ deleted: true });
});

export default { getHealth, listLocations, registerLocation, unregisterLocation };

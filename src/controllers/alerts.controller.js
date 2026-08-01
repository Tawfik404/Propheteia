import { asyncHandler } from '../utils/asyncHandler.js';
import { validateCoordinates } from '../utils/geo.js';
import { alertsService } from '../services/alerts/alerts.service.js';

/**
 * GET /api/alerts
 *
 * Returns the nearby and global alert lists derived from the persisted
 * prediction snapshots.
 *
 * Query parameters:
 *   lat/lon    - reference point for the nearby radius query (optional)
 *   radiusKm   - nearby radius in km (default 600)
 */
export const getAlerts = asyncHandler(async (req, res) => {
  let lat = null;
  let lon = null;
  if (req.query.lat !== undefined || req.query.lon !== undefined) {
    ({ lat, lon } = validateCoordinates(req.query.lat, req.query.lon));
  }

  const result = await alertsService.getAlerts({
    lat,
    lon,
    radiusKm: Number(req.query.radiusKm) || undefined,
  });

  res.json(result);
});

export default getAlerts;

import { asyncHandler } from '../utils/asyncHandler.js';
import geocodeService from '../services/geocode/geocode.service.js';

/**
 * GET /api/geocode
 *
 * Place-name search used by the map search bar.
 *
 * Query parameters:
 *   q      - free-text place query (required, min 2 chars)
 *   limit  - max results (default 8, max 10)
 */
export const getGeocode = asyncHandler(async (req, res) => {
  const query = String(req.query.q ?? '').trim();
  if (query.length < 2) {
    return res.status(400).json({ message: 'Query must be at least 2 characters.' });
  }

  const limit = Math.min(Math.max(Number(req.query.limit) || 8, 1), 10);
  const results = await geocodeService.search(query, limit);

  res.json({ query, count: results.length, results });
});

export default getGeocode;

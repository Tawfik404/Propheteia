import { asyncHandler } from '../utils/asyncHandler.js';
import { validateCoordinates } from '../utils/geo.js';
import PredictionStore from '../db/predictionStore.js';
import { gridService } from '../services/grid/grid.service.js';

/**
 * GET /api/predictions
 *
 * Two modes:
 *
 * 1. Bounds mode (map viewport):
 *      ?north=&south=&east=&west=&z=
 *    Computes a zoom-appropriate prediction grid for the visible region
 *    only — never for the whole world. See GridService.
 *
 * 2. Snapshot mode (legacy):
 *      ?limit=   latest persisted snapshots, newest first
 *      ?lat=&lon=  the single prediction for a coordinate
 */
export const listPredictions = asyncHandler(async (req, res) => {
  if (req.query.north !== undefined) {
    const north = Number(req.query.north);
    const south = Number(req.query.south);
    const east = Number(req.query.east);
    const west = Number(req.query.west);
    if (
      ![north, south, east, west].every(Number.isFinite) ||
      north <= south ||
      east <= west ||
      north > 90 ||
      south < -90 ||
      east > 180 ||
      west < -180
    ) {
      res.status(400).json({ message: 'Invalid bounds: north>south, east>west, within [-90,90]/[-180,180]' });
      return;
    }

    const zoom = Number.isFinite(Number(req.query.z)) ? Number(req.query.z) : 4;
    const result = await gridService.computeRegion({ north, south, east, west, zoom });
    res.json(result);
    return;
  }

  const store = new PredictionStore();

  if (req.query.lat !== undefined || req.query.lon !== undefined) {
    const { lat, lon } = validateCoordinates(req.query.lat, req.query.lon);
    const prediction = store.get(lat, lon);
    res.json({ count: prediction ? 1 : 0, predictions: prediction ? [prediction] : [] });
    return;
  }

  const limit = Math.min(Number.parseInt(req.query.limit, 10) || 50, 200);
  const predictions = store.recent(limit);

  res.json({ count: predictions.length, predictions });
});

export default listPredictions;

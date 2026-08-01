import { asyncHandler } from '../utils/asyncHandler.js';
import { validateCoordinates } from '../utils/geo.js';
import PredictionStore from '../db/predictionStore.js';

/**
 * GET /api/predictions
 *
 * Returns the most recent prediction snapshots (one per location), newest
 * first. These drive the map markers and initial UI state.
 *
 * Query parameters:
 *   limit - maximum number of predictions (default 50)
 *   lat/lon - return only the prediction for this coordinate
 */
export const listPredictions = asyncHandler(async (req, res) => {
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

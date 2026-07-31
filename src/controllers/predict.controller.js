import { asyncHandler } from '../utils/asyncHandler.js';
import { validateCoordinates } from '../utils/geo.js';
import { predictionService } from '../services/prediction/prediction.service.js';

/**
 * GET /api/predict?lat=..&lon=..
 *
 * Returns the full wildfire danger prediction for a coordinate:
 * current weather, all six FWI indices, risk level and estimated
 * fire probability.
 */
export const getPrediction = asyncHandler(async (req, res) => {
  const { lat, lon } = validateCoordinates(req.query.lat, req.query.lon);
  const monitor = req.query.monitor === '1' || req.query.monitor === 'true';

  const prediction = await predictionService.predict(lat, lon, { monitor });

  res.json(prediction);
});

export default getPrediction;

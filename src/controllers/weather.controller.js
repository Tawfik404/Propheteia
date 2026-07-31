import { asyncHandler } from '../utils/asyncHandler.js';
import { validateCoordinates } from '../utils/geo.js';
import { weatherService } from '../services/weather/weather.service.js';

/**
 * GET /api/weather?lat=..&lon=..
 *
 * Returns the raw (normalized) weather data from the active provider
 * (Open-Meteo) for a coordinate. Responses are cached per coordinate.
 */
export const getWeather = asyncHandler(async (req, res) => {
  const { lat, lon } = validateCoordinates(req.query.lat, req.query.lon);
  const bypassCache = req.query.refresh === '1' || req.query.refresh === 'true';

  const weather = await weatherService.getWeather(lat, lon, { bypassCache });

  res.json({
    latitude: lat,
    longitude: lon,
    ...weather,
  });
});

export default getWeather;

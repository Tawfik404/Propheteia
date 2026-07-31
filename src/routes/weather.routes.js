import { Router } from 'express';
import { getWeather } from '../controllers/weather.controller.js';

const router = Router();

/**
 * GET /api/weather
 *
 * Query parameters:
 *   lat      - latitude (decimal degrees, -90..90)    [required]
 *   lon      - longitude (decimal degrees, -180..180) [required]
 *   refresh  - "1"/"true" to bypass the cache         [optional]
 */
router.get('/', getWeather);

export default router;

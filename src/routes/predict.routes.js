import { Router } from 'express';
import { getPrediction } from '../controllers/predict.controller.js';

const router = Router();

/**
 * GET /api/predict
 *
 * Query parameters:
 *   lat      - latitude (decimal degrees, -90..90)        [required]
 *   lon      - longitude (decimal degrees, -180..180)     [required]
 *   monitor  - "1"/"true" to register the location for the
 *              background jobs                            [optional]
 */
router.get('/', getPrediction);

export default router;

import { Router } from 'express';
import predictRoutes from './predict.routes.js';
import weatherRoutes from './weather.routes.js';
import healthRoutes from './health.routes.js';
import locationsRoutes from './locations.routes.js';
import alertsRoutes from './alerts.routes.js';
import predictionsRoutes from './predictions.routes.js';

const router = Router();

/**
 * API route aggregation.
 *
 * All endpoints are exposed under the /api prefix:
 *   GET    /api/predict      wildfire danger prediction
 *   GET    /api/predictions  latest prediction snapshots
 *   GET    /api/alerts       nearby + global alert lists
 *   GET    /api/weather      raw weather data from the active provider
 *   GET    /api/health       server status
 *   GET    /api/locations    monitored location registry (jobs support)
 *   POST   /api/locations
 *   DELETE /api/locations
 */
router.use('/predict', predictRoutes);
router.use('/predictions', predictionsRoutes);
router.use('/alerts', alertsRoutes);
router.use('/weather', weatherRoutes);
router.use('/health', healthRoutes);
router.use('/locations', locationsRoutes);

export default router;

import { Router } from 'express';
import {
  listLocations,
  registerLocation,
  unregisterLocation,
} from '../controllers/health.controller.js';

const router = Router();

/**
 * Monitored-location registry used by the background jobs.
 *
 * GET    /api/locations           - list monitored locations
 * POST   /api/locations           - register { lat, lon, name? }
 * DELETE /api/locations?lat=&lon= - remove a location
 */
router.get('/', listLocations);
router.post('/', registerLocation);
router.delete('/', unregisterLocation);

export default router;

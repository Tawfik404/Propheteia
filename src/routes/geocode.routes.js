import { Router } from 'express';
import { getGeocode } from '../controllers/geocode.controller.js';

const router = Router();

/**
 * GET /api/geocode?q=...&limit=...
 */
router.get('/', getGeocode);

export default router;

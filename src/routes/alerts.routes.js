import { Router } from 'express';
import { getAlerts } from '../controllers/alerts.controller.js';

const router = Router();

/**
 * GET /api/alerts
 *
 * Nearby + global alert lists derived from persisted predictions.
 */
router.get('/', getAlerts);

export default router;

import { Router } from 'express';
import { listPredictions } from '../controllers/predictions.controller.js';

const router = Router();

/**
 * GET /api/predictions
 *
 * Latest prediction snapshots (map markers, initial UI state).
 */
router.get('/', listPredictions);

export default router;

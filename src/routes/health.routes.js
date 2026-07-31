import { Router } from 'express';
import { getHealth } from '../controllers/health.controller.js';

const router = Router();

/** GET /api/health - server status, cache and database health. */
router.get('/', getHealth);

export default router;

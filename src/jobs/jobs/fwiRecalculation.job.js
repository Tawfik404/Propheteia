import logger from '../../utils/logger.js';
import predictionService from '../../services/prediction/prediction.service.js';
import LocationStore from '../../db/locationStore.js';
import { cacheStore } from '../../cache/index.js';

/**
 * Daily FWI recalculation job.
 *
 * Recomputes the fuel moisture codes (FFMC/DMC/DC) and the fire behaviour
 * indices (ISI/BUI/FWI) for every monitored location so the persisted
 * recursive state stays in sync even when nobody queries the API.
 *
 * Runs at 13:00 server time (the FWI System assumes noon observations).
 * Notification delivery is intentionally NOT implemented yet.
 */
class FwiRecalculationJob {
  constructor(store = new LocationStore(), prediction = predictionService) {
    this.store = store;
    this.prediction = prediction;
    this.running = false;
  }

  get cronExpression() {
    return '0 13 * * *'; // daily at 13:00
  }

  async run() {
    if (this.running) {
      logger.warn('[job] fwi-recalculation skipped: previous run still in progress');
      return;
    }
    this.running = true;
    const startedAt = Date.now();

    try {
      const locations = this.store.list();
      if (locations.length === 0) {
        logger.info('[job] fwi-recalculation: no monitored locations');
        return;
      }

      const results = await Promise.allSettled(
        locations.map(async ({ lat, lon }) => {
          try {
            const prediction = await this.prediction.predict(lat, lon);
            return { lat, lon, ok: true, fwi: prediction.indices.FWI };
          } catch (err) {
            return { lat, lon, ok: false, error: err.message };
          }
        })
      );

      const ok = results.filter((r) => r.status === 'fulfilled' && r.value.ok);
      const failed = results.length - ok.length;

      logger.info(
        `[job] fwi-recalculation completed in ${Date.now() - startedAt}ms ` +
          `(ok=${ok.length}, failed=${failed})`,
        { fwiValues: ok.map((r) => r.value.fwi) }
      );
    } catch (err) {
      logger.error(`[job] fwi-recalculation failed: ${err.message}`);
    } finally {
      this.running = false;
    }
  }
}

/**
 * Cache maintenance job.
 *
 * Purges expired entries from the persistent cache tier (SQLite).
 * In-memory entries are swept lazily by the cache itself.
 */
class CacheMaintenanceJob {
  constructor() {
    this.running = false;
  }

  get cronExpression() {
    return '0 3 * * *'; // daily at 03:00
  }

  async run() {
    if (this.running) return;
    this.running = true;
    try {
      const removed = await cacheStore.purgeExpired();
      logger.info(`[job] cache-maintenance: removed ${removed} expired entries`);
    } catch (err) {
      logger.error(`[job] cache-maintenance failed: ${err.message}`);
    } finally {
      this.running = false;
    }
  }
}

export { FwiRecalculationJob, CacheMaintenanceJob };
export default FwiRecalculationJob;

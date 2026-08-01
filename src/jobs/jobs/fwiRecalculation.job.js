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

      // Sequential with a small delay: the weather provider rejects bursts
      // of parallel requests, and a staggered pass keeps the recursive
      // state fresh without hammering the API.
      const fwiValues = [];
      let ok = 0;
      let failed = 0;
      for (const { lat, lon } of locations) {
        try {
          const prediction = await this.prediction.predict(lat, lon);
          ok += 1;
          fwiValues.push(prediction.indices.FWI);
        } catch (err) {
          failed += 1;
          logger.warn(`[job] fwi-recalculation failed for (${lat}, ${lon}): ${err.message}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }

      logger.info(
        `[job] fwi-recalculation completed in ${Date.now() - startedAt}ms ` +
          `(ok=${ok}, failed=${failed})`,
        { fwiValues }
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

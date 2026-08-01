import logger from '../utils/logger.js';
import LocationStore from './locationStore.js';
import predictionService from '../services/prediction/prediction.service.js';
import { SEED_LOCATIONS } from '../config/seedLocations.js';
import { locationKey } from '../utils/geo.js';

/**
 * Register any seed locations that are not monitored yet, then kick off
 * their initial predictions in the background (fire-and-forget, guarded).
 *
 * Returns immediately so the server boots without waiting for the weather
 * provider; the async pass populates the prediction snapshots that power
 * the map markers and global predictions list.
 *
 * Additive on purpose: pre-existing registrations (e.g. a user's own
 * location) are preserved, and only missing seed regions are added.
 *
 * @returns {number} number of newly seeded locations
 */
export function seedIfEmpty() {
  const store = new LocationStore();
  const existing = new Set(store.list().map((loc) => loc.locationKey));

  const toRegister = SEED_LOCATIONS.filter(
    ({ lat, lon }) => !existing.has(locationKey(lat, lon))
  );

  if (toRegister.length === 0) {
    return 0;
  }

  for (const location of toRegister) {
    try {
      store.register(location.lat, location.lon, location.name);
    } catch (err) {
      logger.warn(`[seed] could not register ${location.name}: ${err.message}`);
    }
  }
  logger.info(`[seed] registered ${toRegister.length} monitored locations`);

  // Compute initial predictions asynchronously; never block boot. Requests
  // run sequentially (with a small delay) — the weather provider rejects
  // bursts of parallel requests, and a staggered pass warms the cache
  // without hammering the API.
  (async () => {
    let ok = 0;
    let failed = 0;
    for (const { lat, lon } of toRegister) {
      try {
        await predictionService.predict(lat, lon);
        ok += 1;
      } catch (err) {
        failed += 1;
        logger.warn(`[seed] initial prediction failed for (${lat}, ${lon}): ${err.message}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (failed > 0) {
      logger.warn(`[seed] initial predictions: ok=${ok}, failed=${failed}`);
    } else {
      logger.info(`[seed] initial predictions complete (${ok})`);
    }
  })().catch((err) => {
    logger.error(`[seed] initial prediction pass failed: ${err.message}`);
  });

  return toRegister.length;
}

export default seedIfEmpty;

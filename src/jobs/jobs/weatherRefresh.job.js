import cron from 'node-cron';
import logger from '../../utils/logger.js';
import weatherService from '../../services/weather/weather.service.js';
import LocationStore from '../../db/locationStore.js';
import { eventBus } from '../../utils/eventBus.js';

/**
 * Hourly weather refresh job.
 *
 * For every monitored location, refreshes the cached weather response so
 * the cache never goes stale, and pre-warms the cache for locations the
 * UI is likely to query.
 *
 * Notification delivery is intentionally NOT implemented yet.
 */
class WeatherRefreshJob {
  constructor(store = new LocationStore(), service = weatherService) {
    this.store = store;
    this.service = service;
    this.running = false;
  }

  get cronExpression() {
    return '0 * * * *'; // every hour at minute 0
  }

  async run() {
    if (this.running) {
      logger.warn('[job] weather-refresh skipped: previous run still in progress');
      return;
    }
    this.running = true;
    const startedAt = Date.now();

    try {
      const locations = this.store.list();
      if (locations.length === 0) {
        logger.info('[job] weather-refresh: no monitored locations');
        return;
      }

      // Sequential with a small delay: the weather provider rejects bursts
      // of parallel requests, and a staggered refresh pre-warms the cache
      // without hammering the API.
      let refreshed = 0;
      let failed = 0;
      for (const { lat, lon } of locations) {
        try {
          const weather = await this.service.getWeather(lat, lon, { bypassCache: true });
          eventBus.emit('weather:refreshed', { lat, lon, weather });
          refreshed += 1;
        } catch (err) {
          failed += 1;
          logger.warn(`[job] weather-refresh failed for (${lat}, ${lon}): ${err.message}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }

      logger.info(
        `[job] weather-refresh completed in ${Date.now() - startedAt}ms ` +
          `(refreshed=${refreshed}, failed=${failed})`
      );
    } catch (err) {
      logger.error(`[job] weather-refresh failed: ${err.message}`);
    } finally {
      this.running = false;
    }
  }
}

export default WeatherRefreshJob;

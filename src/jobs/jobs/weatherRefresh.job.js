import cron from 'node-cron';
import logger from '../../utils/logger.js';
import weatherService from '../../services/weather/weather.service.js';
import LocationStore from '../../db/locationStore.js';

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

      const results = await Promise.allSettled(
        locations.map(async ({ lat, lon }) => {
          try {
            await this.service.getWeather(lat, lon, { bypassCache: true });
            return { lat, lon, ok: true };
          } catch (err) {
            return { lat, lon, ok: false, error: err.message };
          }
        })
      );

      const refreshed = results.filter((r) => r.status === 'fulfilled' && r.value.ok).length;
      const failed = results.length - refreshed;

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

import env from '../../config/env.js';
import logger from '../../utils/logger.js';
import { normalizeCoordinates, locationKey } from '../../utils/geo.js';
import { cacheStore } from '../../cache/index.js';
import OpenMeteoProvider from './providers/openMeteo.provider.js';

/**
 * WeatherService.
 *
 * Reusable facade over one or more weather providers. It:
 *   - normalizes payloads from every provider into a single shape,
 *   - caches responses per rounded coordinate so identical requests do not
 *     hit the provider repeatedly (configurable TTL),
 *   - isolates provider failures behind the `ExternalServiceError` type.
 *
 * New providers (e.g. ERA5 reanalysis, NASA POWER) can be added by
 * implementing the same `getWeather(lat, lon)` contract and registering
 * them in `getProvider()`.
 */
export class WeatherService {
  constructor({ provider = null, cache = cacheStore } = {}) {
    this.provider = provider ?? new OpenMeteoProvider();
    this.cache = cache;
    this.providerName = this.provider.constructor.name;
  }

  /**
   * Fetch (and cache) current weather for a coordinate.
   *
   * @param {number} lat
   * @param {number} lon
   * @param {object} [options]
   * @param {boolean} [options.bypassCache=false] - force a provider request
   * @returns {Promise<object>} normalized weather payload
   */
  async getWeather(lat, lon, { bypassCache = false } = {}) {
    const { lat: rLat, lon: rLon } = normalizeCoordinates(lat, lon);
    const key = locationKey(rLat, rLon);

    if (!bypassCache) {
      const cached = this.cache.get(key);
      if (cached !== undefined) return { ...cached, cached: true };
    }

    return this.fetchAndStore(rLat, rLon, key);
  }

  /**
   * Perform the provider request and store the result in every cache tier.
   *
   * @param {number} lat
   * @param {number} lon
   * @param {string} key
   * @returns {Promise<object>} weather payload with cached=false
   */
  async fetchAndStore(lat, lon, key) {
    const startedAt = Date.now();
    try {
      const weather = await this.provider.getWeather(lat, lon);
      const durationMs = Date.now() - startedAt;
      logger.info(`[weather] fetch completed (${durationMs}ms)`, {
        provider: this.providerName,
        lat,
        lon,
      });
      this.cache.set(key, weather);
      return { ...weather, cached: false };
    } catch (err) {
      logger.error(`[weather] fetch failed for (${lat}, ${lon}): ${err.message}`);
      throw err;
    }
  }

  /**
   * Fetch (and cache) weather for many coordinates with a minimum of
   * provider requests: cache hits are served directly, only the missing
   * points are fetched through the provider's batch endpoint.
   *
   * @param {Array<{lat: number, lon: number}>} points
   * @returns {Promise<Map<string, object>>} weather by `lat,lon` key
   */
  async getWeatherBatch(points) {
    const results = new Map();
    const misses = [];

    for (const { lat, lon } of points) {
      const { lat: rLat, lon: rLon } = normalizeCoordinates(lat, lon);
      const key = locationKey(rLat, rLon);
      const cached = this.cache.get(key);
      if (cached !== undefined) {
        results.set(key, { ...cached, cached: true });
      } else {
        misses.push({ lat: rLat, lon: rLon, key });
      }
    }

    if (misses.length > 0) {
      const fetched = await this.provider.getWeatherBatch(
        misses.map(({ lat, lon }) => ({ lat, lon }))
      );
      for (const { key } of misses) {
        const weather = fetched.get(key);
        if (!weather) continue;
        this.cache.set(key, weather);
        results.set(key, { ...weather, cached: false });
      }
    }

    return results;
  }

  /**
   * Remove the cached payload for a coordinate.
   *
   * @param {number} lat
   * @param {number} lon
   */
  async invalidate(lat, lon) {
    const { lat: rLat, lon: rLon } = normalizeCoordinates(lat, lon);
    await this.cache.delete(locationKey(rLat, rLon));
  }
}

/** Singleton weather service for the application. */
export const weatherService = new WeatherService();

export default weatherService;

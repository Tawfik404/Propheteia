import axios from 'axios';
import env from '../../config/env.js';
import { ExternalServiceError, GatewayTimeoutError } from '../../utils/errors.js';
import logger from '../../utils/logger.js';

/**
 * Open-Meteo Geocoding API provider.
 *
 * Documentation: https://open-meteo.com/en/docs/geocoding-api
 *
 * Used to power the map search bar: turns a free-text place query into a
 * list of candidate locations with coordinates.
 */
export class GeocodeService {
  constructor({ baseUrl = env.geocodingBaseUrl, timeoutMs = env.geocodingTimeoutMs } = {}) {
    this.client = axios.create({
      baseURL: baseUrl,
      timeout: timeoutMs,
      headers: { 'User-Agent': 'propheteia-backend/1.0' },
    });
  }

  /**
   * Search places by name.
   *
   * @param {string} query - free-text place name
   * @param {number} limit - max results (1-10)
   * @returns {Promise<object[]>} normalized geocoding results
   * @throws {ExternalServiceError} on provider/network failures
   */
  async search(query, limit = 8) {
    const startedAt = Date.now();
    let response;
    try {
      response = await this.client.get('/v1/search', {
        params: { name: query, count: limit, language: 'en', format: 'json' },
      });
    } catch (err) {
      const durationMs = Date.now() - startedAt;
      if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
        logger.error(`[geocode] request timed out (${durationMs}ms)`);
        throw new GatewayTimeoutError('Geocoding request timed out');
      }
      const status = err.response?.status;
      logger.error(
        `[geocode] request failed (${durationMs}ms) status=${status ?? 'network'}`
      );
      throw new ExternalServiceError('Geocoding service unavailable', {
        provider: 'open-meteo-geocoding',
        status,
        durationMs,
      });
    }

    const durationMs = Date.now() - startedAt;
    logger.info(`[geocode] "${query}" completed (${durationMs}ms)`, { count: limit });

    return this.normalize(response.data);
  }

  /**
   * Map the raw Open-Meteo payload onto the internal search-result shape.
   *
   * @param {object} data - raw geocoding response
   * @returns {object[]} normalized results
   */
  normalize(data) {
    const raw = Array.isArray(data?.results) ? data.results : [];
    return raw
      .filter((item) => Number.isFinite(item?.latitude) && Number.isFinite(item?.longitude))
      .map((item) => ({
        id: item.id ?? null,
        name: item.name ?? 'Unknown',
        latitude: item.latitude,
        longitude: item.longitude,
        country: item.country ?? null,
        admin1: item.admin1 ?? null,
        formatted: [item.name, item.admin1, item.country].filter(Boolean).join(', '),
      }));
  }
}

export default new GeocodeService();

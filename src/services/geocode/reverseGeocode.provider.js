import axios from 'axios';
import env from '../../config/env.js';
import { ExternalServiceError, GatewayTimeoutError } from '../../utils/errors.js';
import logger from '../../utils/logger.js';

/** HTTP statuses worth retrying (rate limits / transient server errors). */
const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);

/** Provider attempts per request (transient-failure only). */
const MAX_ATTEMPTS = 2;

/**
 * Photon reverse geocoding provider (komoot, OSM-based).
 *
 * Documentation: https://photon.komoot.io
 *
 * Free and keyless: a coordinate in, a list of named features out,
 * ordered by distance. Feature properties carry both the feature's own
 * name/type and the address hierarchy of the area containing the point
 * (`city`, `town`, `village`, `county`, `state`, `country`), which the
 * location naming service uses to build human-readable labels.
 */
export class ReverseGeocodeProvider {
  constructor({
    baseUrl = env.reverseGeocodeBaseUrl,
    timeoutMs = env.reverseGeocodeTimeoutMs,
  } = {}) {
    this.client = axios.create({
      baseURL: baseUrl,
      timeout: timeoutMs,
      headers: { 'User-Agent': 'propheteia-backend/1.0' },
    });
  }

  /**
   * Reverse-geocode a coordinate into candidate features (nearest first).
   *
   * @param {number} lat
   * @param {number} lon
   * @param {number} [limit=5]
   * @returns {Promise<Array<object>>} raw Photon features
   * @throws {ExternalServiceError|GatewayTimeoutError} after retries
   */
  async reverse(lat, lon, limit = 5) {
    let lastError = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const startedAt = Date.now();
      try {
        const response = await this.client.get('/reverse', {
          params: { lat, lon, limit, lang: 'en' },
        });
        if (attempt > 1) {
          logger.warn(`[reverse-geocode] recovered (attempt ${attempt}) at ${lat},${lon}`);
        }
        return Array.isArray(response.data?.features) ? response.data.features : [];
      } catch (err) {
        lastError = err;
        const durationMs = Date.now() - startedAt;
        const timedOut = err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT';
        const status = err.response?.status;
        if (attempt < MAX_ATTEMPTS && (timedOut || RETRY_STATUSES.has(status))) {
          await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
          continue;
        }
        if (timedOut) {
          logger.error(`[reverse-geocode] timed out (${durationMs}ms) at ${lat},${lon}`);
          throw new GatewayTimeoutError('Reverse geocoding request timed out', {
            provider: 'photon',
            durationMs,
          });
        }
        logger.error(
          `[reverse-geocode] request failed (${durationMs}ms) status=${status ?? 'network'} at ${lat},${lon}`
        );
        throw new ExternalServiceError('Reverse geocoding service unavailable', {
          provider: 'photon',
          status,
          durationMs,
        });
      }
    }
    throw lastError;
  }
}

export default ReverseGeocodeProvider;

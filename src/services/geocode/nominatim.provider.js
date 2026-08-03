import axios from 'axios';
import env from '../../config/env.js';
import { ExternalServiceError } from '../../utils/errors.js';
import logger from '../../utils/logger.js';

/** Nominatim usage policy: at most 1 request/second. */
const MIN_REQUEST_INTERVAL_MS = 1300;

/**
 * Nominatim reverse geocoding fallback (OpenStreetMap).
 *
 * Policy: https://operations.osmfoundation.org/policies/nominatim/
 *
 * Used only when the primary provider (Photon) returns no features for a
 * coordinate — Photon's index has sparse rural coverage in places where
 * Nominatim's full OSM database does not. A strict request throttle keeps
 * us well inside the 1 req/s usage policy.
 */
export class NominatimProvider {
  constructor({
    baseUrl = env.nominatimBaseUrl,
    timeoutMs = env.nominatimTimeoutMs,
    userAgent = env.nominatimUserAgent,
    minIntervalMs = MIN_REQUEST_INTERVAL_MS,
  } = {}) {
    this.client = axios.create({
      baseURL: baseUrl,
      timeout: timeoutMs,
      headers: { 'User-Agent': userAgent, 'Accept-Language': 'en' },
    });
    this.minIntervalMs = minIntervalMs;
    this.nextAllowedAt = 0;
  }

  /**
   * Reverse-geocode a coordinate (throttled).
   *
   * @param {number} lat
   * @param {number} lon
   * @returns {Promise<object|null>} normalized result or null when the
   *   point has no address information
   * @throws {ExternalServiceError} on provider/network failures
   */
  async reverse(lat, lon) {
    const wait = this.nextAllowedAt - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    this.nextAllowedAt = Date.now() + this.minIntervalMs;

    const startedAt = Date.now();
    let response;
    try {
      response = await this.client.get('/reverse', {
        params: { lat, lon, format: 'jsonv2', zoom: 10, 'accept-language': 'en' },
      });
    } catch (err) {
      const durationMs = Date.now() - startedAt;
      logger.warn(
        `[nominatim] reverse failed (${durationMs}ms) status=${err.response?.status ?? 'network'} at ${lat},${lon}`
      );
      throw new ExternalServiceError('Nominatim reverse geocoding unavailable', {
        provider: 'nominatim',
        status: err.response?.status,
        durationMs,
      });
    }

    const data = response.data;
    if (!data || typeof data !== 'object' || !data.display_name) {
      return null;
    }
    return {
      name: data.name ?? null,
      displayName: data.display_name,
      address: data.address ?? {},
    };
  }
}

export default NominatimProvider;

import axios from 'axios';
import env from '../../../config/env.js';
import { ExternalServiceError, GatewayTimeoutError } from '../../../utils/errors.js';
import logger from '../../../utils/logger.js';

/**
 * Open-Meteo Forecast API provider.
 *
 * Documentation: https://open-meteo.com/en/docs
 *
 * Requests the variables required by the FWI System for a location:
 *   - temperature_2m            (°C)      air temperature at 2 m
 *   - relative_humidity_2m      (%)       relative humidity at 2 m
 *   - wind_speed_10m            (km/h)    wind speed at 10 m (open exposure)
 *   - precipitation             (mm)      precipitation at the current instant
 *   - precipitation_sum         (mm)      accumulated precipitation for today
 *   - weather_code              (WMO)     weather condition code
 *
 * `precipitation_sum` (daily) is the 24-hour rainfall used by the FWI
 * System, since the system expects a 24-hour accumulated rainfall input
 * (Van Wagner 1987).
 */

/** HTTP statuses worth retrying (rate limits + transient server errors). */
const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);
/** Total attempts per request (1 initial + 2 retries). */
const MAX_ATTEMPTS = 3;
/** Pause between sequential batch chunks (politeness vs. rate limits). */
const BATCH_PACING_MS = 800;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class OpenMeteoProvider {
  constructor({ baseUrl = env.openMeteoBaseUrl, timeoutMs = env.openMeteoTimeoutMs } = {}) {
    this.client = axios.create({
      baseURL: baseUrl,
      timeout: timeoutMs,
      headers: { 'User-Agent': 'propheteia-backend/1.0' },
    });
  }

  /**
   * GET with retry: transient failures (timeouts, 429, 5xx) are retried
   * with exponential backoff (honoring `Retry-After` when present) so a
   * rate-limited provider does not fail an entire grid computation.
   *
   * @param {string} url
   * @param {object} params - axios query params
   * @param {string} label - log label, e.g. "request" or "batch"
   * @returns {Promise<import('axios').AxiosResponse>}
   * @throws {GatewayTimeoutError|ExternalServiceError} when all attempts fail
   */
  async fetchWithRetry(url, params, label) {
    let lastError = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const startedAt = Date.now();
      try {
        return await this.client.get(url, { params });
      } catch (err) {
        const durationMs = Date.now() - startedAt;
        lastError = err;
        const status = err.response?.status;
        const timedOut = err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT';
        const retriable = timedOut || RETRY_STATUSES.has(status);
        if (!retriable || attempt === MAX_ATTEMPTS) {
          if (timedOut) {
            logger.error(`[weather] open-meteo ${label} request timed out (${durationMs}ms)`);
            throw new GatewayTimeoutError('Weather service request timed out');
          }
          logger.error(
            `[weather] open-meteo ${label} request failed (${durationMs}ms) status=${status ?? 'network'}`
          );
          throw new ExternalServiceError(
            'Weather service unavailable',
            { provider: 'open-meteo', status, durationMs }
          );
        }
        const retryAfterSec = Number(err.response?.headers?.['retry-after']);
        const delayMs = Number.isFinite(retryAfterSec) && retryAfterSec > 0
          ? retryAfterSec * 1000
          : Math.min(4000, 500 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 250);
        logger.warn(
          `[weather] open-meteo ${label} request failed (status=${status ?? 'network'}), ` +
            `retrying in ${delayMs}ms (attempt ${attempt}/${MAX_ATTEMPTS})`
        );
        await sleep(delayMs);
      }
    }
    throw lastError;
  }

  /**
   * Fetch current weather for a coordinate.
   *
   * @param {number} lat
   * @param {number} lon
   * @returns {Promise<object>} normalized weather payload (see `normalize`)
   * @throws {ExternalServiceError} on provider/network failures
   */
  async getWeather(lat, lon) {
    const startedAt = Date.now();
    const response = await this.fetchWithRetry(
      '/v1/forecast',
      {
        latitude: lat,
        longitude: lon,
        current: 'temperature_2m,relative_humidity_2m,wind_speed_10m,precipitation,weather_code',
        daily: 'precipitation_sum',
        timezone: 'auto',
        wind_speed_unit: 'kmh',
        forecast_days: 1,
      },
      'forecast'
    );

    const durationMs = Date.now() - startedAt;
    logger.info(`[weather] open-meteo request completed (${durationMs}ms)`, { lat, lon });

    return this.normalize(response.data);
  }

  /**
   * Fetch current weather for many coordinates in batched requests.
   *
   * Open-Meteo accepts repeated `latitude`/`longitude` parameters and
   * answers with one full response per location. Points are chunked (one
   * HTTP request per chunk, executed sequentially) to stay below the
   * provider's 100-location per-request cap.
   *
   * @param {Array<{lat: number, lon: number}>} points
   * @returns {Promise<Map<string, object>>} normalized weather by `lat,lon` key.
   *   Chunks that keep failing are skipped (logged, not fatal) so a
   *   rate-limited or flaky provider degrades the result instead of
   *   failing an entire grid computation.
   */
  async getWeatherBatch(points, { chunkSize = 40 } = {}) {
    const results = new Map();
    let chunkIndex = 0;
    for (let i = 0; i < points.length; i += chunkSize) {
      const chunk = points.slice(i, i + chunkSize);
      try {
        const startedAt = Date.now();
        const params = [];
        for (const { lat, lon } of chunk) {
          params.push(`latitude=${lat}&longitude=${lon}`);
        }
        const response = await this.fetchWithRetry(
          `/v1/forecast?${params.join('&')}`,
          {
            current: 'temperature_2m,relative_humidity_2m,wind_speed_10m,precipitation,weather_code',
            daily: 'precipitation_sum',
            timezone: 'auto',
            wind_speed_unit: 'kmh',
            forecast_days: 1,
          },
          'batch'
        );

        const durationMs = Date.now() - startedAt;
        logger.info(`[weather] open-meteo batch completed (${durationMs}ms)`, {
          points: chunk.length,
        });

        const entries = Array.isArray(response.data) ? response.data : [];
        for (let index = 0; index < chunk.length && index < entries.length; index += 1) {
          const { lat, lon } = chunk[index];
          try {
            results.set(this.locationKey(lat, lon), this.normalize(entries[index]));
          } catch {
            // skip a malformed entry; the caller falls back to per-point fetch
          }
        }
      } catch (err) {
        logger.warn(
          `[weather] open-meteo batch chunk failed after retries (${chunk.length} points), skipping: ${err.message?.slice(0, 120)}`
        );
      }
      chunkIndex += 1;
      if (i + chunkSize < points.length) await sleep(BATCH_PACING_MS);
    }
    return results;
  }

  /** Stable cache key matching the weather service (4-decimal rounding). */
  locationKey(lat, lon) {
    return `${lat.toFixed(4)},${lon.toFixed(4)}`;
  }

  /**
   * Map the raw Open-Meteo payload onto the internal weather shape shared
   * by every provider.
   *
   * @param {object} data - raw Open-Meteo forecast response
   * @returns {object} normalized weather
   * @throws {ExternalServiceError} when required values are missing
   */
  normalize(data) {
    const current = data?.current;
    if (!current || typeof current !== 'object') {
      throw new ExternalServiceError(
        'Invalid response from weather service: missing "current" block',
        { provider: 'open-meteo' }
      );
    }

    const {
      temperature_2m,
      relative_humidity_2m,
      wind_speed_10m,
      precipitation,
      weather_code,
    } = current;

    if (!Number.isFinite(temperature_2m)) {
      throw new ExternalServiceError(
        'Invalid response from weather service: missing temperature_2m',
        { provider: 'open-meteo' }
      );
    }

    const rainfall24h = Number.isFinite(data?.daily?.precipitation_sum?.[0])
      ? data.daily.precipitation_sum[0]
      : precipitation ?? 0;

    return {
      provider: 'open-meteo',
      observedAt: current.time ?? new Date().toISOString(),
      temperature: Number(temperature_2m.toFixed(1)),
      humidity: Number(relative_humidity_2m.toFixed(1)),
      windSpeed: Number(wind_speed_10m.toFixed(1)),
      precipitation: precipitation ?? 0,
      rainfall24h: Number(rainfall24h.toFixed(1)),
      weatherCode: weather_code ?? null,
      timezone: data?.timezone ?? null,
    };
  }
}

export default OpenMeteoProvider;

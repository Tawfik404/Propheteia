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
export class OpenMeteoProvider {
  constructor({ baseUrl = env.openMeteoBaseUrl, timeoutMs = env.openMeteoTimeoutMs } = {}) {
    this.client = axios.create({
      baseURL: baseUrl,
      timeout: timeoutMs,
      headers: { 'User-Agent': 'propheteia-backend/1.0' },
    });
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
    let response;
    try {
      response = await this.client.get('/v1/forecast', {
        params: {
          latitude: lat,
          longitude: lon,
          current: 'temperature_2m,relative_humidity_2m,wind_speed_10m,precipitation,weather_code',
          daily: 'precipitation_sum',
          timezone: 'auto',
          wind_speed_unit: 'kmh',
          forecast_days: 1,
        },
      });
    } catch (err) {
      const durationMs = Date.now() - startedAt;
      if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
        logger.error(`[weather] open-meteo request timed out (${durationMs}ms)`);
        throw new GatewayTimeoutError('Weather service request timed out');
      }
      const status = err.response?.status;
      logger.error(
        `[weather] open-meteo request failed (${durationMs}ms) status=${status ?? 'network'}`
      );
      throw new ExternalServiceError(
        'Weather service unavailable',
        { provider: 'open-meteo', status, durationMs }
      );
    }

    const durationMs = Date.now() - startedAt;
    logger.info(`[weather] open-meteo request completed (${durationMs}ms)`, { lat, lon });

    return this.normalize(response.data);
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

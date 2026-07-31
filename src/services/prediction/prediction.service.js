import { weatherService } from '../weather/weather.service.js';
import { fwiService } from '../fwi/fwi.service.js';
import { mapFwiToRisk } from '../alerts/risk.mapper.js';
import FwiStateStore from '../../db/fwiStateStore.js';
import LocationStore from '../../db/locationStore.js';
import { normalizeCoordinates } from '../../utils/geo.js';
import { UnprocessableEntityError } from '../../utils/errors.js';
import logger from '../../utils/logger.js';

/** Local YYYY-MM-DD date for the FWI "today" observation. */
function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * PredictionService.
 *
 * End-to-end wildfire danger prediction for a geographic coordinate:
 *
 *   1. fetch current weather (cached) from the weather service,
 *   2. load the previous day's FFMC/DMC/DC for the location,
 *   3. compute the six FWI indices (official Canadian FWI System),
 *   4. persist today's fuel moisture codes for the recursive
 *      calculation on the next request,
 *   5. map FWI to a risk level and estimated probability (UI only).
 */
export class PredictionService {
  constructor({
    weather = weatherService,
    fwi = fwiService,
    stateStore = new FwiStateStore(),
    locationStore = new LocationStore(),
  } = {}) {
    this.weather = weather;
    this.fwi = fwi;
    this.stateStore = stateStore;
    this.locationStore = locationStore;
  }

  /**
   * Predict wildfire danger for a coordinate.
   *
   * @param {number} lat
   * @param {number} lon
   * @param {object} [options]
   * @param {boolean} [options.monitor=false] - register the location so
   *        background jobs keep its state fresh
   * @returns {Promise<object>} full prediction payload (see README)
   */
  async predict(lat, lon, { monitor = false } = {}) {
    const { lat: rLat, lon: rLon } = normalizeCoordinates(lat, lon);
    const date = todayDate();

    const startedAt = Date.now();

    // 1. Weather (cached upstream).
    const weather = await this.weather.getWeather(rLat, rLon);

    if (
      !Number.isFinite(weather.temperature) ||
      !Number.isFinite(weather.humidity) ||
      !Number.isFinite(weather.windSpeed) ||
      !Number.isFinite(weather.rainfall24h)
    ) {
      throw new UnprocessableEntityError(
        'Weather data incomplete: temperature, humidity, wind speed and rainfall are required'
      );
    }

    // 2. Previous day's fuel moisture codes.
    const previous = this.stateStore.getPreviousState(rLat, rLon, date);

    // 3. FWI computation.
    const indices = this.fwi.computeDaily(weather, previous, {
      lat: rLat,
      month: new Date().getMonth() + 1,
    });

    // 4. Persist state for the next recursive step.
    this.stateStore.saveState(rLat, rLon, date, indices, weather);

    // 5. Risk mapping (UI estimate; FWI remains the scientific indicator).
    const risk = mapFwiToRisk(indices.fwi);

    if (monitor) {
      this.locationStore.register(rLat, rLon);
    }

    const durationMs = Date.now() - startedAt;
    logger.info(`[predict] prediction completed (${durationMs}ms)`, { lat: rLat, lon: rLon });

    return {
      latitude: rLat,
      longitude: rLon,
      predictedAt: new Date().toISOString(),
      weather: {
        temperature: weather.temperature,
        humidity: weather.humidity,
        windSpeed: weather.windSpeed,
        precipitation: weather.precipitation,
        rainfall24h: weather.rainfall24h,
        weatherCode: weather.weatherCode,
        observedAt: weather.observedAt,
        provider: weather.provider,
        cached: weather.cached,
      },
      indices: {
        FFMC: Number(indices.ffmc.toFixed(1)),
        DMC: Number(indices.dmc.toFixed(1)),
        DC: Number(indices.dc.toFixed(1)),
        ISI: Number(indices.isi.toFixed(1)),
        BUI: Number(indices.bui.toFixed(1)),
        FWI: risk.fwi,
        DSR: Number(indices.dsr.toFixed(2)),
      },
      riskLevel: risk.riskLevel,
      fireProbability: risk.fireProbability,
      state: {
        date,
        previousDate: previous.date,
        usedStartupValues: previous.date === null,
      },
    };
  }
}

/** Singleton prediction service for the application. */
export const predictionService = new PredictionService();

export default predictionService;

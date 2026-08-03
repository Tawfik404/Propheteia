import { weatherService } from '../weather/weather.service.js';
import { fwiService } from '../fwi/fwi.service.js';
import { mapFwiToRisk } from '../alerts/risk.mapper.js';
import { namingService } from '../geocode/locationNaming.service.js';
import { composePrediction } from './payload.js';
import FwiStateStore from '../../db/fwiStateStore.js';
import LocationStore from '../../db/locationStore.js';
import PredictionStore from '../../db/predictionStore.js';
import { normalizeCoordinates, locationKey } from '../../utils/geo.js';
import { UnprocessableEntityError } from '../../utils/errors.js';
import { eventBus } from '../../utils/eventBus.js';
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
    names = namingService,
    stateStore = new FwiStateStore(),
    locationStore = new LocationStore(),
    predictionStore = new PredictionStore(),
  } = {}) {
    this.weather = weather;
    this.fwi = fwi;
    this.names = names;
    this.stateStore = stateStore;
    this.locationStore = locationStore;
    this.predictionStore = predictionStore;
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

    // 1. Weather (cached upstream), with reverse-geocoded naming running
    //    in parallel so the point gets a readable name without slowing
    //    the prediction (both resolve in the same request).
    const namePromise = this.names.resolveMany([{ lat: rLat, lon: rLon }], {
      timeBudgetMs: 4000,
    });
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

    // Monitored-location names win; anything else falls back to the
    // reverse-geocoded label (or its cached value when still pending).
    const namesByKey = await namePromise;
    const monitoredName = this.locationName(rLat, rLon);
    const name = monitoredName ?? namesByKey.get(locationKey(rLat, rLon)) ?? null;

    const prediction = composePrediction({
      lat: rLat,
      lon: rLon,
      weather,
      indices,
      risk,
      date,
      previous,
      name,
    });

    // Persist the snapshot so REST endpoints can serve it without
    // recomputing, then notify real-time subscribers. The previous risk
    // level lets the transport detect risk changes and alert transitions.
    const previousPrediction = this.predictionStore.get(rLat, rLon);
    this.predictionStore.save(prediction, name);
    eventBus.emit('prediction:computed', {
      prediction,
      previousRiskLevel: previousPrediction?.riskLevel ?? null,
    });

    const durationMs = Date.now() - startedAt;
    logger.info(`[predict] prediction completed (${durationMs}ms)`, { lat: rLat, lon: rLon });

    return prediction;
  }

  /**
   * Human-readable name for a monitored location, if any.
   *
   * @param {number} lat
   * @param {number} lon
   * @returns {string|null}
   */
  locationName(lat, lon) {
    const key = locationKey(lat, lon);
    const entry = this.locationStore.list().find((loc) => loc.locationKey === key);
    return entry?.name ?? null;
  }
}

/** Singleton prediction service for the application. */
export const predictionService = new PredictionService();

export default predictionService;

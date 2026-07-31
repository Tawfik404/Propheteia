import { DEFAULT_STARTUP, DEFAULT_REFERENCE_LATITUDE } from '../../config/constants.js';
import { fineFuelMoistureCode } from './ffmc.js';
import { duffMoistureCode } from './dmc.js';
import { droughtCode } from './dc.js';
import { initialSpreadIndex } from './isi.js';
import { buildupIndex } from './bui.js';
import { fireWeatherIndex, dailySeverityRating } from './fwi.js';

/**
 * FwiService.
 *
 * Orchestrates the computation of the complete Canadian Forest Fire
 * Weather Index (FWI) System for a single day, following the official
 * computation order (Van Wagner 1987; cffdrs `fwi()`):
 *
 *   1. FFMC from (previous FFMC, T, RH, W, rain)
 *   2. DMC  from (previous DMC, T, RH, rain, latitude, month)
 *   3. DC   from (previous DC, T, RH, rain, latitude, month)
 *   4. ISI  from (today's FFMC, W)
 *   5. BUI  from (today's DMC, DC)
 *   6. FWI  from (today's ISI, BUI)
 *
 * Because the three moisture codes are recursive, the caller is
 * responsible for supplying the previous day's values (see
 * `db/fwiStateStore.js`, which persists them per location).
 */
export class FwiService {
  constructor({ startup = DEFAULT_STARTUP, referenceLatitude = DEFAULT_REFERENCE_LATITUDE } = {}) {
    this.startup = startup;
    this.referenceLatitude = referenceLatitude;
  }

  /**
   * Compute the six FWI indices for one day.
   *
   * @param {object} weather - normalized weather payload:
   *        { temperature, humidity, windSpeed, rainfall24h }
   * @param {object} [previous] - previous day's fuel moisture codes:
   *        { ffmc, dmc, dc }
   * @param {object} [options]
   * @param {number} [options.lat] - latitude used for day-length adjustments
   * @param {number} [options.month] - month of the year, 1..12
   * @param {boolean} [options.latAdjust=true] - apply latitude adjustment
   * @returns {object} today's indices: { ffmc, dmc, dc, isi, bui, fwi, dsr }
   */
  computeDaily(weather, previous = {}, { lat, month, latAdjust = true } = {}) {
    const prev = {
      ffmc: Number.isFinite(previous.ffmc) ? previous.ffmc : this.startup.ffmc,
      dmc: Number.isFinite(previous.dmc) ? previous.dmc : this.startup.dmc,
      dc: Number.isFinite(previous.dc) ? previous.dc : this.startup.dc,
    };

    const rh = Math.min(Math.max(Number(weather.humidity) || 0, 0), 99.9999);
    const temp = Number(weather.temperature) || 0;
    const ws = Math.max(Number(weather.windSpeed) || 0, 0);
    const rainfall = Math.max(Number(weather.rainfall24h) || 0, 0);
    const monthResolved = Number.isInteger(month) && month >= 1 && month <= 12 ? month : new Date().getMonth() + 1;
    const latResolved = Number.isFinite(lat) ? lat : this.referenceLatitude;

    // 1-3: fuel moisture codes (recursive bookkeeping).
    const ffmc = fineFuelMoistureCode(prev.ffmc, temp, rh, ws, rainfall);
    const dmc = duffMoistureCode(prev.dmc, temp, rh, rainfall, latResolved, monthResolved, latAdjust);
    const dc = droughtCode(prev.dc, temp, rh, rainfall, latResolved, monthResolved, latAdjust);

    // 4-6: fire behaviour indices (derived from today's moisture codes).
    const isi = initialSpreadIndex(ffmc, ws);
    const bui = buildupIndex(dmc, dc);
    const fwi = fireWeatherIndex(isi, bui);
    const dsr = dailySeverityRating(fwi);

    return { ffmc, dmc, dc, isi, bui, fwi, dsr };
  }
}

/** Singleton FWI service for the application. */
export const fwiService = new FwiService();

export default fwiService;

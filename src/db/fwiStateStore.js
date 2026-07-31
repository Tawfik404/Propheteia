import { getDatabase } from '../db/database.js';
import { locationKey } from '../utils/geo.js';
import env from '../config/env.js';

/**
 * Persistence for the recursive fuel moisture codes (FFMC, DMC, DC).
 *
 * The FWI System is a bookkeeping system: today's values are computed from
 * today's weather and *yesterday's* FFMC/DMC/DC. This store keeps the latest
 * state per location and provides a sensible startup value when no previous
 * state exists (Van Wagner 1987 recommended springtime values).
 */
export class FwiStateStore {
  constructor(db = getDatabase()) {
    this.db = db;
    this.startup = env.fwiStartup;
  }

  /**
   * Retrieve the most recent state stored for a location on or before the
   * given date. Falls back to the standard startup values when nothing has
   * been persisted yet.
   *
   * @param {number} lat
   * @param {number} lon
   * @param {string} date - YYYY-MM-DD (the day being computed)
   * @returns {{ ffmc: number, dmc: number, dc: number, date: string|null }}
   */
  getPreviousState(lat, lon, date) {
    const row = this.db
      .prepare(
        `SELECT ffmc, dmc, dc, date
           FROM fwi_state
          WHERE location_key = ? AND date < ?
          ORDER BY date DESC
          LIMIT 1`
      )
      .get(locationKey(lat, lon), date);

    if (!row) {
      return { ffmc: this.startup.ffmc, dmc: this.startup.dmc, dc: this.startup.dc, date: null };
    }
    return { ffmc: row.ffmc, dmc: row.dmc, dc: row.dc, date: row.date };
  }

  /**
   * Persist the computed state for a location and date (upsert).
   *
   * @param {number} lat
   * @param {number} lon
   * @param {string} date - YYYY-MM-DD
   * @param {object} indices - full set of computed indices
   * @param {object} weather - weather values used for the computation
   */
  saveState(lat, lon, date, indices, weather) {
    this.db
      .prepare(
        `INSERT INTO fwi_state (
           location_key, date, ffmc, dmc, dc, isi, bui, fwi, dsr,
           temperature, humidity, wind_speed, rainfall_24h, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(location_key, date) DO UPDATE SET
           ffmc = excluded.ffmc,
           dmc = excluded.dmc,
           dc = excluded.dc,
           isi = excluded.isi,
           bui = excluded.bui,
           fwi = excluded.fwi,
           dsr = excluded.dsr,
           temperature = excluded.temperature,
           humidity = excluded.humidity,
           wind_speed = excluded.wind_speed,
           rainfall_24h = excluded.rainfall_24h,
           updated_at = datetime('now')`
      )
      .run(
        locationKey(lat, lon),
        date,
        indices.ffmc,
        indices.dmc,
        indices.dc,
        indices.isi,
        indices.bui,
        indices.fwi,
        indices.dsr,
        weather.temperature,
        weather.humidity,
        weather.windSpeed,
        weather.rainfall24h
      );
  }

  /**
   * Return the most recently stored state for a location (any date).
   * Used by background jobs to know when the last recalculation happened.
   *
   * @param {number} lat
   * @param {number} lon
   */
  getLatestState(lat, lon) {
    return this.db
      .prepare(
        `SELECT ffmc, dmc, dc, isi, bui, fwi, dsr, date
           FROM fwi_state
          WHERE location_key = ?
          ORDER BY date DESC
          LIMIT 1`
      )
      .get(locationKey(lat, lon));
  }
}

export default FwiStateStore;

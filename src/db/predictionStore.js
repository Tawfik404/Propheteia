import { getDatabase } from './database.js';
import { locationKey, normalizeCoordinates } from '../utils/geo.js';

/**
 * Persistence for computed predictions.
 *
 * Every prediction computed by the service (API requests and background
 * jobs) is upserted here per location, so the REST layer can serve the
 * latest snapshot for the map markers, the global predictions list and
 * the nearby-alerts radius query without recomputing everything.
 */
export class PredictionStore {
  constructor(db = getDatabase()) {
    this.db = db;
  }

  /**
   * Upsert the latest prediction for a location.
   *
   * @param {object} prediction - full prediction payload (see README)
   * @param {string|null} [name] - human-readable location name
   */
  save(prediction, name = null) {
    const { lat: rLat, lon: rLon } = normalizeCoordinates(
      prediction.latitude,
      prediction.longitude
    );
    const key = locationKey(rLat, rLon);

    this.db
      .prepare(
        `INSERT INTO predictions (
           location_key, lat, lon, name, risk_level, fire_probability,
           fwi, temperature, humidity, wind_speed, payload, predicted_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(location_key) DO UPDATE SET
           name = COALESCE(excluded.name, predictions.name),
           risk_level = excluded.risk_level,
           fire_probability = excluded.fire_probability,
           fwi = excluded.fwi,
           temperature = excluded.temperature,
           humidity = excluded.humidity,
           wind_speed = excluded.wind_speed,
           payload = excluded.payload,
           predicted_at = excluded.predicted_at`
      )
      .run(
        key,
        rLat,
        rLon,
        name,
        prediction.riskLevel,
        prediction.fireProbability,
        prediction.indices.FWI,
        prediction.weather.temperature,
        prediction.weather.humidity,
        prediction.weather.windSpeed,
        JSON.stringify(prediction),
        prediction.predictedAt
      );
  }

  /**
   * Most recent predictions, newest first.
   *
   * @param {number} [limit=50]
   * @returns {Array<object>} full prediction payloads
   */
  recent(limit = 50) {
    return this.db
      .prepare(
        `SELECT payload, name, predicted_at
           FROM predictions
          ORDER BY predicted_at DESC
          LIMIT ?`
      )
      .all(limit)
      .map((row) => this.#toPrediction(row));
  }

  /**
   * Trim the store to the newest `maxRows` predictions.
   *
   * The viewport grid engine upserts many cells per request; this keeps
   * the table (and therefore the alerts lists) bounded.
   *
   * @param {number} [maxRows=3000]
   * @returns {number} number of deleted rows
   */
  prune(maxRows = 3000) {
    const stale = this.db
      .prepare(
        `SELECT location_key
           FROM predictions
          ORDER BY predicted_at DESC
          LIMIT -1 OFFSET ?`
      )
      .all(maxRows);

    if (stale.length === 0) return 0;

    const deleteStmt = this.db.prepare('DELETE FROM predictions WHERE location_key = ?');
    const remove = this.db.transaction(() => {
      for (const row of stale) deleteStmt.run(row.location_key);
      return stale.length;
    });

    return remove();
  }

  /**
   * Latest prediction for a single location.
   *
   * @param {number} lat
   * @param {number} lon
   * @returns {object|null} full prediction payload or null
   */
  get(lat, lon) {
    const row = this.db
      .prepare(
        `SELECT payload, name, predicted_at
           FROM predictions
          WHERE location_key = ?`
      )
      .get(locationKey(lat, lon));
    return row ? this.#toPrediction(row) : null;
  }

  /**
   * Rebuild a prediction payload from a stored row.
   *
   * @param {object} row
   * @returns {object}
   */
  #toPrediction(row) {
    const prediction = JSON.parse(row.payload);
    if (row.name) prediction.name = row.name;
    return prediction;
  }
}

export default PredictionStore;

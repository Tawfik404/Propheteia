import { getDatabase } from '../db/database.js';
import { locationKey, normalizeCoordinates } from '../utils/geo.js';

/**
 * Registry of monitored locations.
 *
 * Background jobs (weather refresh, index recalculation) iterate over the
 * locations registered here. Locations can also be registered implicitly by
 * passing `monitor=1` to the prediction endpoint.
 */
export class LocationStore {
  constructor(db = getDatabase()) {
    this.db = db;
  }

  /**
   * @param {number} lat
   * @param {number} lon
   * @param {string} [name]
   * @returns {{ locationKey: string, lat: number, lon: number, name: string|null, inserted: boolean }}
   */
  register(lat, lon, name = null) {
    const { lat: rLat, lon: rLon } = normalizeCoordinates(lat, lon);
    const key = locationKey(rLat, rLon);
    const existing = this.db
      .prepare('SELECT location_key FROM monitored_locations WHERE location_key = ?')
      .get(key);
    if (existing) return { locationKey: key, lat: rLat, lon: rLon, name: null, inserted: false };

    this.db
      .prepare('INSERT INTO monitored_locations (location_key, lat, lon, name) VALUES (?, ?, ?, ?)')
      .run(key, rLat, rLon, name);
    return { locationKey: key, lat: rLat, lon: rLon, name, inserted: true };
  }

  /** @returns {Array<{locationKey: string, lat: number, lon: number, name: string|null}>} */
  list() {
    return this.db
      .prepare(
        'SELECT location_key AS locationKey, lat, lon, name FROM monitored_locations ORDER BY created_at'
      )
      .all();
  }

  /**
   * @param {number} lat
   * @param {number} lon
   * @returns {boolean} true when a location was removed
   */
  unregister(lat, lon) {
    const { lat: rLat, lon: rLon } = normalizeCoordinates(lat, lon);
    const result = this.db
      .prepare('DELETE FROM monitored_locations WHERE location_key = ?')
      .run(locationKey(rLat, rLon));
    return result.changes > 0;
  }
}

export default LocationStore;

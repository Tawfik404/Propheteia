import { getDatabase } from '../../db/database.js';
import { locationKey, normalizeCoordinates } from '../../utils/geo.js';

/**
 * Persistent cache for land-cover classifications.
 *
 * A location's land cover changes rarely (yearly satellite products), so
 * classifications are cached per rounded coordinate ("grid cell id") and
 * reused across requests and server restarts. Rows store:
 *
 *   - grid cell id (rounded location key),
 *   - land-cover type + class id,
 *   - vegetation status (flammable / water / …) + estimated coverage %,
 *   - data source and sample timestamp.
 *
 * TTL handling lives in LandCoverService (entries older than the
 * configured lifetime are treated as missing); this store is only the
 * persistence layer.
 */
export class LandCoverStore {
  constructor(db = getDatabase()) {
    this.db = db;
  }

  /**
   * Load the cached classification for a coordinate.
   *
   * @param {number} lat
   * @param {number} lon
   * @returns {object|null} cached classification info or null
   */
  get(lat, lon) {
    const row = this.db
      .prepare(
        `SELECT lat, lon, class_id, type, vegetation_cover, flammable,
                water, source, sampled_at
           FROM land_cover_cache
          WHERE location_key = ?`
      )
      .get(locationKey(lat, lon));
    return row ? this.#toInfo(row) : null;
  }

  /**
   * Persist a classification.
   *
   * @param {object} info - classification produced by LandCoverService
   */
  set(info) {
    const { lat: rLat, lon: rLon } = normalizeCoordinates(info.lat, info.lon);
    this.db
      .prepare(
        `INSERT INTO land_cover_cache (
           location_key, lat, lon, class_id, type, vegetation_cover,
           flammable, water, source, sampled_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(location_key) DO UPDATE SET
           class_id = excluded.class_id,
           type = excluded.type,
           vegetation_cover = excluded.vegetation_cover,
           flammable = excluded.flammable,
           water = excluded.water,
           source = excluded.source,
           sampled_at = excluded.sampled_at`
      )
      .run(
        locationKey(rLat, rLon),
        rLat,
        rLon,
        info.classId ?? null,
        info.type,
        info.vegetationCoverage ?? null,
        info.flammable ? 1 : 0,
        info.water ? 1 : 0,
        info.source,
        info.sampledAt ?? new Date().toISOString()
      );
  }

  /**
   * Remove classifications older than a cutoff timestamp.
   *
   * @param {string} cutoffIso - ISO timestamp; older rows are deleted
   * @returns {number} number of deleted rows
   */
  purgeOlderThan(cutoffIso) {
    return this.db
      .prepare('DELETE FROM land_cover_cache WHERE sampled_at < ?')
      .run(cutoffIso).changes;
  }

  /**
   * Total number of cached classifications.
   *
   * @returns {number}
   */
  get size() {
    return this.db.prepare('SELECT COUNT(*) AS n FROM land_cover_cache').get().n;
  }

  /** Rebuild a classification info object from a stored row. */
  #toInfo(row) {
    return {
      lat: row.lat,
      lon: row.lon,
      classId: row.class_id,
      type: row.type,
      vegetationCoverage: row.vegetation_cover,
      flammable: row.flammable === 1,
      water: row.water === 1,
      source: row.source,
      sampledAt: row.sampled_at,
    };
  }
}

export default LandCoverStore;

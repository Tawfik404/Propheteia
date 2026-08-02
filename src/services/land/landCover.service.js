import LandMaskProvider from './landMask.provider.js';
import { locationKey } from '../../utils/geo.js';

/**
 * LandCoverService.
 *
 * Decides whether a coordinate is a meaningful place to predict wildfire
 * danger. The current default provider is a static land/water mask; the
 * provider interface (`isLand(lat, lon)`) keeps the door open for richer
 * land-cover datasets later:
 *
 *   - forests, grasslands, shrublands, agricultural vegetation
 *   - permanent ice / permafrost exclusion
 *   - MODIS/Sentinel-derived fuel classes
 *   - NASA FIRMS integration (active fires as validation)
 *
 * Results are memoized per rounded coordinate so repeated viewport
 * requests never re-run the geometry tests.
 */
export class LandCoverService {
  constructor({ provider = new LandMaskProvider() } = {}) {
    this.provider = provider;
    this.cache = new Map();
  }

  /**
   * Whether a coordinate is on land (memoized).
   *
   * @param {number} lat
   * @param {number} lon
   * @returns {boolean}
   */
  isLand(lat, lon) {
    const key = locationKey(lat, lon);
    let result = this.cache.get(key);
    if (result === undefined) {
      result = this.provider.isLand(lat, lon);
      this.cache.set(key, result);
    }
    return result;
  }

  /**
   * Whether a coordinate can support a wildfire.
   *
   * Provisional rules until vegetation data is integrated:
   *   - Antarctica (permanent ice, no combustible vegetation) is excluded.
   *
   * @param {number} lat
   * @param {number} lon
   * @returns {boolean}
   */
  isBurnable(lat, lon) {
    if (lat < -60) return false;
    return this.isLand(lat, lon);
  }
}

/** Singleton land-cover service for the application. */
export const landCoverService = new LandCoverService();

export default landCoverService;

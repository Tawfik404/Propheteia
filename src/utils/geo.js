import { BadRequestError } from './errors.js';
import { COORDINATE_ROUNDING } from '../config/constants.js';

const LAT_MIN = -90;
const LAT_MAX = 90;
const LON_MIN = -180;
const LON_MAX = 180;

/**
 * Parse and validate a latitude/longitude pair coming from a request.
 *
 * @param {unknown} rawLat - raw query value
 * @param {unknown} rawLon - raw query value
 * @returns {{ lat: number, lon: number }} validated coordinates
 * @throws {BadRequestError} when the coordinates are missing or out of range
 */
export function validateCoordinates(rawLat, rawLon) {
  if (rawLat === undefined || rawLat === null || rawLon === undefined || rawLon === null) {
    throw new BadRequestError('Both "lat" and "lon" query parameters are required');
  }

  const lat = Number(rawLat);
  const lon = Number(rawLon);

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw new BadRequestError('"lat" and "lon" must be valid numbers');
  }
  if (lat < LAT_MIN || lat > LAT_MAX) {
    throw new BadRequestError(`"lat" must be between ${LAT_MIN} and ${LAT_MAX}`);
  }
  if (lon < LON_MIN || lon > LON_MAX) {
    throw new BadRequestError(`"lon" must be between ${LON_MIN} and ${LON_MAX}`);
  }

  return { lat, lon };
}

/**
 * Round coordinates to the configured precision (~11 m at rounding 4).
 * Used to build stable cache keys so near-identical coordinates reuse
 * the same cached resources.
 *
 * @param {number} lat
 * @param {number} lon
 * @returns {{ lat: number, lon: number }}
 */
export function normalizeCoordinates(lat, lon) {
  return {
    lat: Number(lat.toFixed(COORDINATE_ROUNDING)),
    lon: Number(lon.toFixed(COORDINATE_ROUNDING)),
  };
}

/**
 * Stable string key for a rounded location.
 *
 * @param {number} lat
 * @param {number} lon
 * @returns {string} e.g. "31.6300,-8.0100"
 */
export function locationKey(lat, lon) {
  return `${lat.toFixed(COORDINATE_ROUNDING)},${lon.toFixed(COORDINATE_ROUNDING)}`;
}

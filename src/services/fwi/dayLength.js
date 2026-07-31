import { DMC_DAY_LENGTH, DC_DAY_LENGTH_FACTOR, DEFAULT_REFERENCE_LATITUDE } from '../../config/constants.js';

/**
 * Day-length adjustments for the DMC and DC codes.
 *
 * The FWI System assumes observations are taken at noon local standard time
 * and that drying depends on day length, which varies by latitude and
 * season (Van Wagner 1987, Tables 1 and 2). The tables below follow the
 * operational Canadian implementation (cffdrs; Lawson & Armitage 2008).
 */

/**
 * Day length (in hours) used in the DMC drying-rate equation.
 *
 * @param {number} lat - latitude in decimal degrees (negative = southern hemisphere)
 * @param {number} month - month of the year, 1..12
 * @param {boolean} [latAdjust=true] - apply latitude adjustment
 * @returns {number} day length in hours
 */
export function dmcDayLength(lat, month, latAdjust = true) {
  if (!latAdjust) return DMC_DAY_LENGTH.northTemperate[month - 1];

  if (lat > 30) return DMC_DAY_LENGTH.northTemperate[month - 1];
  if (lat > 10) return DMC_DAY_LENGTH.northSubtropical[month - 1];
  if (lat >= -10) return DMC_DAY_LENGTH.equatorial;
  if (lat >= -30) return DMC_DAY_LENGTH.southSubtropical[month - 1];
  return DMC_DAY_LENGTH.southTemperate[month - 1];
}

/**
 * Day-length factor used in the DC potential-evapotranspiration equation.
 *
 * @param {number} lat - latitude in decimal degrees
 * @param {number} month - month of the year, 1..12
 * @param {boolean} [latAdjust=true] - apply latitude adjustment
 * @returns {number} day length factor
 */
export function dcDayLengthFactor(lat, month, latAdjust = true) {
  if (!latAdjust) return DC_DAY_LENGTH_FACTOR.north[month - 1];

  if (lat > 20) return DC_DAY_LENGTH_FACTOR.north[month - 1];
  if (lat >= -20) return DC_DAY_LENGTH_FACTOR.equatorial;
  return DC_DAY_LENGTH_FACTOR.south[month - 1];
}

/**
 * Resolve the latitude actually used for day-length adjustments.
 *
 * @param {number|null|undefined} lat
 * @returns {number} the latitude, or the system reference latitude
 */
export function resolveReferenceLatitude(lat) {
  return Number.isFinite(lat) ? lat : DEFAULT_REFERENCE_LATITUDE;
}

export default { dmcDayLength, dcDayLengthFactor, resolveReferenceLatitude };

/**
 * Constants for the Canadian Forest Fire Weather Index (FWI) System.
 *
 * Equations follow the official operational formulation of the system:
 *
 * - Van Wagner, C.E.; Pickett, T.L. 1985. "Equations and FORTRAN program for
 *   the Canadian Forest Fire Weather Index System." Forestry Technical
 *   Report 33. Canadian Forestry Service, Petawawa National Forestry
 *   Institute.
 * - Van Wagner, C.E. 1987. "Development and structure of the Canadian Forest
 *   Fire Weather Index System." Forestry Technical Report 35. Canadian
 *   Forestry Service, Ottawa.
 *
 * The operational reference implementation (used by the Canadian Wildland
 * Fire Information System and reproduced here) is the one distributed with
 * the `cffdrs` R package (Wang et al., Canadian Forest Service), which was
 * derived from the original Fortran code of Van Wagner & Pickett (1985).
 */

/**
 * Conversion coefficient between the FFMC code units and the fine-fuel
 * moisture content (%) used internally by the system.
 */
export const FFMC_COEFFICIENT = (250.0 * 59.5) / 101.0;

/**
 * Default (start-up) fuel moisture code values recommended by the FWI
 * System for springtime conditions (Van Wagner 1987; cffdrs `fwi()`).
 */
export const DEFAULT_STARTUP = Object.freeze({
  ffmc: 85,
  dmc: 6,
  dc: 15,
});

/** Maximum value the fine fuel moisture content may reach (%). */
export const FFMC_MAX_MOISTURE = 250;

/** FFMC output is bounded to the [0, 101] scale. */
export const FFMC_MAX = 101;
export const FFMC_MIN = 0;

/**
 * Day-length (hours) used by the DMC drying rate equation, per latitude
 * band and month (Van Wagner 1987, Table 2; cffdrs `duff_moisture_code`).
 * Indexed by month 1..12 (January = index 0).
 *
 * ell01: latitudes > 30 deg N (Canadian standard, reference 46 N)
 * ell02: 10 deg N < latitude <= 30 deg N
 * ell03: -30 deg N < latitude <= -10 deg N
 * ell04: latitude <= -30 deg N
 * equatorial band (|lat| <= 10): constant 9 hours
 */
export const DMC_DAY_LENGTH = Object.freeze({
  northTemperate: [6.5, 7.5, 9.0, 12.8, 13.9, 13.9, 12.4, 10.9, 9.4, 8.0, 7.0, 6.0],
  northSubtropical: [7.9, 8.4, 8.9, 9.5, 9.9, 10.2, 10.1, 9.7, 9.1, 8.6, 8.1, 7.8],
  southSubtropical: [10.1, 9.6, 9.1, 8.5, 8.1, 7.8, 7.9, 8.3, 8.9, 9.4, 9.9, 10.2],
  southTemperate: [11.5, 10.5, 9.2, 7.9, 6.8, 6.2, 6.5, 7.4, 8.7, 10.0, 11.2, 11.8],
  equatorial: 9.0,
});

/**
 * Day-length factor used by the DC potential evapotranspiration equation,
 * per latitude band and month (Van Wagner 1987, Table 1; cffdrs
 * `drought_code`). Indexed by month 1..12 (January = index 0).
 *
 * fl01: latitudes > 20 deg N
 * fl02: latitudes < -20 deg S
 * equatorial band (-20 <= lat <= 20): constant 1.4
 */
export const DC_DAY_LENGTH_FACTOR = Object.freeze({
  north: [-1.6, -1.6, -1.6, 0.9, 3.8, 5.8, 6.4, 5.0, 2.4, 0.4, -1.6, -1.6],
  south: [6.4, 5.0, 2.4, 0.4, -1.6, -1.6, -1.6, -1.6, -1.6, 0.9, 3.8, 5.8],
  equatorial: 1.4,
});

/**
 * Default latitude used for the day-length adjustment when a location's
 * latitude is not available (reference latitude used by cffdrs).
 */
export const DEFAULT_REFERENCE_LATITUDE = 55;

/**
 * FWI -> risk level / estimated fire probability mapping.
 *
 * The FWI System does not produce a probability percentage. The FWI value is
 * the scientific indicator; the probability below is an *estimated*
 * percentage used only for UI purposes, derived by linear interpolation of
 * the FWI within each band. Bands follow the standard FWI danger scale
 * (Very Low 0-5, Low 5-12, Moderate 12-21, High 21-38, Extreme > 38).
 *
 * Band boundaries are upper-exclusive: an FWI of exactly 5.0 maps to
 * Very Low, just above 5.0 maps to Low, and so on.
 */
export const RISK_BANDS = Object.freeze([
  { name: 'Very Low', maxFwi: 5, minProbability: 0, maxProbability: 20 },
  { name: 'Low', maxFwi: 12, minProbability: 20, maxProbability: 40 },
  { name: 'Moderate', maxFwi: 21, minProbability: 40, maxProbability: 60 },
  { name: 'High', maxFwi: 38, minProbability: 60, maxProbability: 80 },
  { name: 'Extreme', maxFwi: Infinity, minProbability: 80, maxProbability: 100 },
]);

/** Coordinate rounding precision used to build location cache keys (~11 m). */
export const COORDINATE_ROUNDING = 4;

/** Open-Meteo variables required for the FWI System. */
export const OPEN_METEO_REQUIRED_FIELDS = Object.freeze([
  'temperature_2m',
  'relative_humidity_2m',
  'wind_speed_10m',
  'precipitation',
  'precipitation_sum',
  'weather_code',
]);

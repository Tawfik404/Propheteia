import { dcDayLengthFactor } from './dayLength.js';

/**
 * Drought Code (DC).
 *
 * Indicates the average moisture content of deep, compact organic layers
 * (deep duff and woody material). It is a slow-responding code that tracks
 * seasonal drought. Higher values mean deeper and drier layers. Scale:
 * 0 (wet) to 800+ (extreme drought).
 *
 * Equations follow the operational formulation of the Canadian FWI System
 * (Van Wagner & Pickett 1985, Forestry Technical Report 33; Van Wagner
 * 1987, Forestry Technical Report 35; as implemented in the official
 * `cffdrs` reference library).
 *
 * @param {number} dcYda - previous day's DC
 * @param {number} temp - noon air temperature (°C)
 * @param {number} rh - noon relative humidity (%)
 * @param {number} prec - 24-hour accumulated rainfall (mm)
 * @param {number} [lat=55] - latitude (decimal degrees) for day-length adjustment
 * @param {number} [month=7] - month of the year, 1..12
 * @param {boolean} [latAdjust=true] - apply latitude day-length adjustment
 * @returns {number} today's DC
 */
export function droughtCode(dcYda, temp, rh, prec, lat = 55, month = 7, latAdjust = true) {
  // Constrain the low end of temperature: below -2.8 °C no drying occurs.
  const t = temp < -2.8 ? -2.8 : temp;

  const fl = dcDayLengthFactor(lat, month, latAdjust);

  // Eq. 22: potential evapotranspiration, capped at zero for the winter
  // months when the DC cannot increase.
  let pe = (0.36 * (t + 2.8) + fl) / 2;
  if (pe < 0) pe = 0;

  const ra = prec;

  // Eq. 18: effective rainfall (only rainfall above 2.8 mm matters).
  const rw = 0.83 * ra - 1.27;

  // Eq. 19: moisture content of the deep organic layer.
  const smi = 800 * Math.exp(-dcYda / 400);

  // Alteration to Eq. 21 used by the operational implementation.
  let dr0 = dcYda - 400 * Math.log(1 + (3.937 * rw) / smi);
  if (dr0 < 0) dr0 = 0;

  // If precipitation is less than 2.8 mm, the rain has no effect on DC.
  const dr = prec <= 2.8 ? dcYda : dr0;

  // Final DC: yesterday's value (rain-adjusted) plus today's
  // evapotranspiration-driven drying.
  let dc = dr + pe;
  if (dc < 0) dc = 0;

  return dc;
}

export default droughtCode;

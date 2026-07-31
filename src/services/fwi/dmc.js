import { dmcDayLength } from './dayLength.js';

/**
 * Duff Moisture Code (DMC).
 *
 * Indicates the average moisture content of loosely compacted organic
 * layers of moderate depth (the duff layer). Higher values mean the duff
 * layer is drier and more available to burn. Scale: 0 (wet) to 100+
 * (very dry).
 *
 * Equations follow the operational formulation of the Canadian FWI System
 * (Van Wagner & Pickett 1985, Forestry Technical Report 33; Van Wagner
 * 1987, Forestry Technical Report 35; as implemented in the official
 * `cffdrs` reference library).
 *
 * @param {number} dmcYda - previous day's DMC
 * @param {number} temp - noon air temperature (°C)
 * @param {number} rh - noon relative humidity (%)
 * @param {number} prec - 24-hour accumulated rainfall (mm)
 * @param {number} [lat=55] - latitude (decimal degrees) for day-length adjustment
 * @param {number} [month=7] - month of the year, 1..12
 * @param {boolean} [latAdjust=true] - apply latitude day-length adjustment
 * @returns {number} today's DMC
 */
export function duffMoistureCode(dmcYda, temp, rh, prec, lat = 55, month = 7, latAdjust = true) {
  // Constrain the low end of temperature: below -1.1 °C no drying occurs.
  const t = temp < -1.1 ? -1.1 : temp;

  // Eq. 16: the logarithmic drying rate, using the day length for the
  // latitude band and month.
  const ell = dmcDayLength(lat, month, latAdjust);
  const rk = 1.894 * (t + 1.1) * (100 - rh) * ell * 1e-4;

  let pr;
  if (prec <= 1.5) {
    // No effective rain: keep the previous day's moisture.
    pr = dmcYda;
  } else {
    const ra = prec;

    // Eq. 11: net rain amount (losses in the overhead canopy).
    const rw = 0.92 * ra - 1.27;

    // Alteration to Eq. 12 used by the operational implementation to
    // calculate the moisture content more accurately.
    const wmi = 20 + 280 / Math.exp(0.023 * dmcYda);

    // Eqs. 13a, 13b, 13c: slope parameter of the moisture-uptake curve.
    let b;
    if (dmcYda <= 33) b = 100 / (0.5 + 0.3 * dmcYda);
    else if (dmcYda <= 65) b = 14 - 1.3 * Math.log(dmcYda);
    else b = 6.2 * Math.log(dmcYda) - 17.2;

    // Eq. 14: moisture content after rain.
    const wmr = wmi + (1000 * rw) / (48.77 + b * rw);

    // Alteration to Eq. 15 used by the operational implementation.
    pr = 43.43 * (5.6348 - Math.log(wmr - 20));
  }

  if (pr < 0) pr = 0;

  // Final DMC: previous moisture (or rain-adjusted) plus today's drying.
  let dmc = pr + rk;
  if (dmc < 0) dmc = 0;

  return dmc;
}

export default duffMoistureCode;

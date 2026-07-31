import {
  FFMC_COEFFICIENT,
  FFMC_MAX,
  FFMC_MIN,
  FFMC_MAX_MOISTURE,
} from '../../config/constants.js';

/**
 * Fine Fuel Moisture Code (FFMC).
 *
 * Indicates the relative ease of ignition and flammability of fine fuel
 * (litter and other cured fine fuels). Higher values mean drier fuels.
 * Scale: 0 (completely wet) to 101 (completely dry).
 *
 * Equations follow the operational formulation of the Canadian FWI System
 * (Van Wagner & Pickett 1985, Forestry Technical Report 33; Van Wagner
 * 1987, Forestry Technical Report 35; as implemented in the official
 * `cffdrs` reference library).
 *
 * @param {number} ffmcYda - previous day's FFMC
 * @param {number} temp - noon air temperature (°C)
 * @param {number} rh - noon relative humidity (%)
 * @param {number} ws - noon 10-m open wind speed (km/h)
 * @param {number} prec - 24-hour accumulated rainfall (mm)
 * @returns {number} today's FFMC
 */
export function fineFuelMoistureCode(ffmcYda, temp, rh, ws, prec) {
  // Eq. 1: convert the previous day's code to fine-fuel moisture content.
  let wmo = (FFMC_COEFFICIENT * (101 - ffmcYda)) / (59.5 + ffmcYda);

  // Eq. 2: rain reduction allowing for loss in the overhead canopy.
  // Only rainfall above 0.5 mm reaches the fine-fuel layer.
  const ra = prec > 0.5 ? prec - 0.5 : prec;

  // Eqs. 3a/3b: effect of rain on moisture content.
  if (prec > 0.5) {
    const rainTerm =
      42.5 * ra * Math.exp(-100 / (251 - wmo)) * (1 - Math.exp(-6.93 / ra));
    wmo =
      wmo > 150
        ? wmo + 0.0015 * (wmo - 150) * (wmo - 150) * Math.sqrt(ra) + rainTerm
        : wmo + rainTerm;
    // The real moisture content of pine litter ranges up to about 250%.
    if (wmo > FFMC_MAX_MOISTURE) wmo = FFMC_MAX_MOISTURE;
  }

  // Eq. 4: equilibrium moisture content from drying.
  const ed =
    0.942 * Math.pow(rh, 0.679) +
    11 * Math.exp((rh - 100) / 10) +
    0.18 * (21.1 - temp) * (1 - Math.exp(-0.115 * rh));

  // Eq. 5: equilibrium moisture content from wetting.
  const ew =
    0.618 * Math.pow(rh, 0.753) +
    10 * Math.exp((rh - 100) / 10) +
    0.18 * (21.1 - temp) * (1 - Math.exp(-0.115 * rh));

  // Eq. 6a/6b/8: wetting when the fuel is drier than both equilibrium levels.
  let wm = wmo;
  if (wmo < ed && wmo < ew) {
    const z =
      0.424 * (1 - Math.pow((100 - rh) / 100, 1.7)) +
      0.0694 * Math.sqrt(ws) * (1 - Math.pow((100 - rh) / 100, 8));
    const x = z * 0.581 * Math.exp(0.0365 * temp);
    wm = ew - (ew - wmo) / Math.pow(10, x);
  }

  // Eq. 7a/7b/9: drying when the fuel is wetter than the drying equilibrium.
  if (wmo > ed) {
    const z =
      0.424 * (1 - Math.pow(rh / 100, 1.7)) +
      0.0694 * Math.sqrt(ws) * (1 - Math.pow(rh / 100, 8));
    const x = z * 0.581 * Math.exp(0.0365 * temp);
    wm = ed + (wmo - ed) / Math.pow(10, x);
  }

  // Eq. 10: convert moisture content back to FFMC code units.
  let ffmc = (59.5 * (FFMC_MAX_MOISTURE - wm)) / (FFMC_COEFFICIENT + wm);

  // Constraints: FFMC is defined on the [0, 101] scale.
  if (ffmc > FFMC_MAX) ffmc = FFMC_MAX;
  if (ffmc < FFMC_MIN) ffmc = FFMC_MIN;

  return ffmc;
}

export default fineFuelMoistureCode;

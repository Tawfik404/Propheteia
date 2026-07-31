import { FFMC_COEFFICIENT } from '../../config/constants.js';

/**
 * Initial Spread Index (ISI).
 *
 * Estimates the expected rate of fire spread immediately after ignition,
 * combining the effect of wind and the fine-fuel moisture content.
 * Unitless; higher values mean faster potential spread.
 *
 * Equations follow the operational formulation of the Canadian FWI System
 * (Van Wagner & Pickett 1985, Forestry Technical Report 33; Van Wagner
 * 1987, Forestry Technical Report 35; as implemented in the official
 * `cffdrs` reference library).
 *
 * @param {number} ffmc - today's FFMC
 * @param {number} ws - noon 10-m open wind speed (km/h)
 * @param {boolean} [fbpMod=false] - apply the Fire Behaviour Prediction
 *        modification to the wind factor at very high wind speeds
 *        (Equation 53a in FCFDG 1992). Only used by the FBP System; the
 *        standard FWI System leaves this disabled.
 * @returns {number} ISI
 */
export function initialSpreadIndex(ffmc, ws, fbpMod = false) {
  // Eq. 10: fine-fuel moisture content (%) from the FFMC code.
  const fm = (FFMC_COEFFICIENT * (101 - ffmc)) / (59.5 + ffmc);

  // Eq. 24: wind factor. With the FBP modification the wind factor is
  // capped at high wind speeds.
  const fW =
    ws >= 40 && fbpMod
      ? 12 * (1 - Math.exp(-0.0818 * (ws - 28)))
      : Math.exp(0.05039 * ws);

  // Eq. 25: fine-fuel moisture factor.
  const fF = 91.9 * Math.exp(-0.1386 * fm) * (1 + Math.pow(fm, 5.31) / 49300000);

  // Eq. 26: initial spread index.
  return 0.208 * fW * fF;
}

export default initialSpreadIndex;

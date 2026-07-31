/**
 * Fire Weather Index (FWI).
 *
 * The final index of the FWI System: a relative measure of the expected
 * fire intensity per unit length of the fire front. It combines the ISI
 * (spread potential) with the BUI (fuel availability). Higher values mean
 * more severe fire behaviour.
 *
 * Equations follow the operational formulation of the Canadian FWI System
 * (Van Wagner & Pickett 1985, Forestry Technical Report 33; Van Wagner
 * 1987, Forestry Technical Report 35; as implemented in the official
 * `cffdrs` reference library).
 *
 * @param {number} isi - today's ISI
 * @param {number} bui - today's BUI
 * @returns {number} FWI
 */
export function fireWeatherIndex(isi, bui) {
  // Eqs. 28b/28a: the buildup effect (duff moisture modifier).
  const bb =
    bui > 80
      ? 0.1 * isi * (1000 / (25 + 108.64 / Math.exp(0.023 * bui)))
      : 0.1 * isi * (0.626 * Math.pow(bui, 0.809) + 2);

  // Eqs. 30b/30a: the final FWI.
  return bb <= 1 ? bb : Math.exp(2.72 * Math.pow(0.434 * Math.log(bb), 0.647));
}

/**
 * Daily Severity Rating (DSR).
 *
 * A transformed version of the FWI that better reflects the difficulty of
 * fire control, used by fire management agencies for seasonal trend
 * analysis (Van Wagner 1987, Eq. 31).
 *
 * @param {number} fwi
 * @returns {number} DSR
 */
export function dailySeverityRating(fwi) {
  return 0.0272 * Math.pow(fwi, 1.77);
}

export default fireWeatherIndex;

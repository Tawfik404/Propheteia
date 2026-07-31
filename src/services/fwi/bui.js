/**
 * Build-Up Index (BUI).
 *
 * Combines the DMC and DC to estimate the total amount of fuel available
 * for combustion. Higher values mean more fuel available to burn.
 * Unitless; scale roughly 0 to 100+.
 *
 * Equations follow the operational formulation of the Canadian FWI System
 * (Van Wagner & Pickett 1985, Forestry Technical Report 33; Van Wagner
 * 1987, Forestry Technical Report 35; as implemented in the official
 * `cffdrs` reference library).
 *
 * @param {number} dmc - today's DMC
 * @param {number} dc - today's DC
 * @returns {number} BUI
 */
export function buildupIndex(dmc, dc) {
  // When both codes are zero there is no build-up at all.
  if (dmc === 0 && dc === 0) return 0;

  // Eq. 27a: BUI when DMC is low relative to DC.
  const bui1 = (0.8 * dc * dmc) / (dmc + 0.4 * dc);

  // Eq. 27b: adjusted BUI when DMC is the dominant code.
  const p = dmc === 0 ? 0 : (dmc - bui1) / dmc;
  const cc = 0.92 + Math.pow(0.0114 * dmc, 1.7);
  let bui0 = dmc - cc * p;
  if (bui0 < 0) bui0 = 0;

  // The final BUI is bui1 unless it exceeds DMC, in which case the
  // adjusted value is used.
  return bui1 < dmc ? bui0 : bui1;
}

export default buildupIndex;

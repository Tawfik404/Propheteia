import { RISK_BANDS } from '../../config/constants.js';

/**
 * Maps an FWI value to a danger level and an *estimated* fire probability.
 *
 * IMPORTANT: the FWI System itself does not produce a probability. The FWI
 * value is the scientific indicator. The probability is provided ONLY for
 * UI purposes, derived from the standard FWI danger scale (Van Wagner 1987;
 * as published by fire management agencies, e.g. Natural Resources Canada)
 * using linear interpolation of the FWI within each band:
 *
 *   | FWI    | Risk level | Estimated probability |
 *   | ------ | ---------- | --------------------- |
 *   | 0-5    | Very Low   | 0-20%                 |
 *   | 5-12   | Low        | 20-40%                |
 *   | 12-21  | Moderate   | 40-60%                |
 *   | 21-38  | High       | 60-80%                |
 *   | >38    | Extreme    | 80-100%               |
 *
 * Band boundaries are upper-exclusive (FWI = 5.0 is Very Low, FWI > 5.0 is
 * Low). The raw FWI is always returned alongside the mapping and is never
 * replaced by the percentage.
 */

/**
 * @param {number} fwi - Fire Weather Index value
 * @returns {{ fwi: number, riskLevel: string, fireProbability: number }}
 */
export function mapFwiToRisk(fwi) {
  if (!Number.isFinite(fwi) || fwi < 0) {
    return { fwi, riskLevel: 'Unknown', fireProbability: 0 };
  }

  const band = RISK_BANDS.find((b) => fwi <= b.maxFwi) ?? RISK_BANDS[RISK_BANDS.length - 1];

  const lowerFwi = bandIndexLowerBound(band);
  const spread = band.maxFwi - lowerFwi || 1;
  const probabilityRange = band.maxProbability - band.minProbability;
  const probability =
    band.minProbability + (probabilityRange * (fwi - lowerFwi)) / spread;

  return {
    fwi: Number(fwi.toFixed(1)),
    riskLevel: band.name,
    fireProbability: Math.round(probability),
  };
}

/**
 * Lower FWI bound of a band: 0 for the first band, the previous band's
 * upper bound otherwise.
 *
 * @param {object} band - a RISK_BANDS entry
 * @returns {number}
 */
function bandIndexLowerBound(band) {
  const index = RISK_BANDS.indexOf(band);
  return index === 0 ? 0 : RISK_BANDS[index - 1].maxFwi;
}

/**
 * Human-readable description of the mapping used by the API consumers.
 *
 * @returns {Array<object>}
 */
export function describeRiskBands() {
  return RISK_BANDS.map((band) => ({
    riskLevel: band.name,
    maxFwi: band.maxFwi === Infinity ? null : band.maxFwi,
    probabilityRange: [band.minProbability, band.maxProbability],
  }));
}

export default mapFwiToRisk;

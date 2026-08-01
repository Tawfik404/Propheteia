import type { RiskLevel } from '../types';

/**
 * Risk level → color mapping shared by the map markers, the legend and the
 * risk badges. Green = Low, Yellow = Moderate, Orange = High, Red = Extreme.
 */
export const riskColors: Record<RiskLevel, string> = {
  'Very Low': '#4F7B58',
  Low: '#8BB37F',
  Moderate: '#E3C43B',
  High: '#E09132',
  Extreme: '#AB3130',
};

/** Risk level → badge colors with sufficient contrast. */
export const riskBadgeColors: Record<RiskLevel, { bg: string; text: string }> = {
  'Very Low': { bg: '#4F7B58', text: '#fff' },
  Low: { bg: '#8BB37F', text: '#17301C' },
  Moderate: { bg: '#E3C43B', text: '#3A2E00' },
  High: { bg: '#E09132', text: '#fff' },
  Extreme: { bg: '#AB3130', text: '#fff' },
};

/** Numeric order of the risk levels (higher = more dangerous). */
export const riskRank: Record<RiskLevel, number> = {
  'Very Low': 0,
  Low: 1,
  Moderate: 2,
  High: 3,
  Extreme: 4,
};

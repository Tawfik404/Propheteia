import type { RiskLevel } from '../types';
import { riskBadgeColors } from '../utils/risk';

interface RiskBadgeProps {
  level: RiskLevel;
}

export default function RiskBadge({ level }: RiskBadgeProps) {
  const { bg, text } = riskBadgeColors[level] ?? riskBadgeColors.Low;
  return (
    <span
      className="risk-badge"
      style={{ backgroundColor: bg, color: text }}
      aria-label={`${level} risk`}
    >
      {level} Risk
    </span>
  );
}

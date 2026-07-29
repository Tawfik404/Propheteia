import type { RiskLevel } from '../types';

const colors: Record<RiskLevel, { bg: string; text: string }> = {
  Low: { bg: '#4F7B58', text: '#fff' },
  Medium: { bg: '#ECE0A6', text: '#540302' },
  High: { bg: '#AB3130', text: '#fff' },
};

interface RiskBadgeProps {
  level: RiskLevel;
}

export default function RiskBadge({ level }: RiskBadgeProps) {
  const { bg, text } = colors[level];
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

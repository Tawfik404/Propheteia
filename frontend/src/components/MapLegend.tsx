import { riskColors } from '../utils/risk';

const items = [
  { color: riskColors['Very Low'], label: 'Very Low Risk' },
  { color: riskColors.Low, label: 'Low Risk' },
  { color: riskColors.Moderate, label: 'Moderate Risk' },
  { color: riskColors.High, label: 'High Risk' },
  { color: riskColors.Extreme, label: 'Extreme Risk' },
];

export default function MapLegend() {
  return (
    <div className="map-legend" role="complementary" aria-label="Map legend">
      <h4 className="map-legend-title">Risk Levels</h4>
      {items.map(({ color, label }) => (
        <div key={label} className="map-legend-item">
          <span
            className="map-legend-dot"
            style={{ backgroundColor: color }}
          />
          <span className="map-legend-label">{label}</span>
        </div>
      ))}
    </div>
  );
}

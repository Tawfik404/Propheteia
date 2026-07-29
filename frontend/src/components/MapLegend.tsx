export default function MapLegend() {
  const items = [
    { color: '#4F7B58', label: 'Low Risk' },
    { color: '#ECE0A6', label: 'Medium Risk' },
    { color: '#AB3130', label: 'High Risk' },
  ];

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

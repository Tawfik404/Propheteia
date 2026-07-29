import { Thermometer, Droplets, Wind, ShieldAlert, MapPin, BrainCircuit } from 'lucide-react';
import type { MapInfo } from '../types';

interface MapInfoPanelProps {
  info: MapInfo;
}

export default function MapInfoPanel({ info }: MapInfoPanelProps) {
  const rows = [
    { icon: MapPin, label: 'Location', value: info.location },
    { icon: ShieldAlert, label: 'Probability', value: `${info.probability}%` },
    { icon: Thermometer, label: 'Temperature', value: `${info.temperature}°C` },
    { icon: Droplets, label: 'Humidity', value: `${info.humidity}%` },
    { icon: Wind, label: 'Wind Speed', value: `${info.windSpeed} km/h` },
    { icon: BrainCircuit, label: 'Confidence', value: `${info.confidence}%` },
  ];

  return (
    <div className="map-info-panel" role="complementary" aria-label="Location information">
      <h4 className="map-info-title">Location Info</h4>
      <div className="map-info-rows">
        {rows.map(({ icon: Icon, label, value }) => (
          <div key={label} className="map-info-row">
            <div className="map-info-label">
              <Icon size={14} />
              <span>{label}</span>
            </div>
            <span className="map-info-value">{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

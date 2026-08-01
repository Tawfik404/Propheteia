import { Thermometer, Droplets, Wind, ShieldAlert, MapPin, Ruler, Clock } from 'lucide-react';
import RiskBadge from './RiskBadge';
import type { MapInfo } from '../types';

interface MapInfoPanelProps {
  info: MapInfo;
}

function formatUpdated(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function MapInfoPanel({ info }: MapInfoPanelProps) {
  const rows = [
    { icon: MapPin, label: 'Location', value: info.location },
    { icon: ShieldAlert, label: 'Fire Probability', value: `${info.probability}%` },
    { icon: Ruler, label: 'FWI', value: String(info.fwi) },
    { icon: Thermometer, label: 'Temperature', value: `${info.temperature}°C` },
    { icon: Droplets, label: 'Humidity', value: `${info.humidity}%` },
    { icon: Wind, label: 'Wind Speed', value: `${info.windSpeed} km/h` },
    { icon: Clock, label: 'Last Updated', value: formatUpdated(info.lastUpdated) },
  ];

  return (
    <div className="map-info-panel" role="complementary" aria-label="Location information">
      <h4 className="map-info-title">Location Info</h4>
      <div className="map-info-risk">
        <RiskBadge level={info.riskLevel} />
      </div>
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

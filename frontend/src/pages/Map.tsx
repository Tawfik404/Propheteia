import { useEffect, useRef, useState } from 'react';
import { LocateFixed } from 'lucide-react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import MapLegend from '../components/MapLegend';
import MapInfoPanel from '../components/MapInfoPanel';
import { mapMarkers, defaultMapInfo } from '../mockData';
import type { MapInfo } from '../types';

const riskColors: Record<string, string> = {
  Low: '#4F7B58',
  Medium: '#ECE0A6',
  High: '#AB3130',
};

export default function MapPage() {
  const mapRef = useRef<L.Map | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const [info, setInfo] = useState<MapInfo>(defaultMapInfo);

  useEffect(() => {
    if (mapContainerRef.current && !mapRef.current) {
      const map = L.map(mapContainerRef.current, {
        center: [40, 0],
        zoom: 2,
        zoomControl: false,
      });

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
      }).addTo(map);

      L.control.zoom({ position: 'bottomright' }).addTo(map);

      mapMarkers.forEach(marker => {
        const color = riskColors[marker.riskLevel];
        L.circleMarker([marker.lat, marker.lng], {
          radius: 12,
          fillColor: color,
          color: '#fff',
          weight: 2,
          opacity: 1,
          fillOpacity: 0.8,
        })
          .addTo(map)
          .bindPopup(`<b>${marker.location}</b><br/>${marker.riskLevel} Risk`);
      });

      mapRef.current = map;
    }

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  const handleGPS = () => {
    // Placeholder - no GPS functionality
  };

  return (
    <div className="page map-page">
      <div ref={mapContainerRef} className="map-container" role="application" aria-label="Wildfire risk map" />
      <MapLegend />
      <MapInfoPanel info={info} />
      <button
        className="map-gps-btn"
        onClick={handleGPS}
        type="button"
        aria-label="Locate my position"
      >
        <LocateFixed size={22} />
      </button>
    </div>
  );
}

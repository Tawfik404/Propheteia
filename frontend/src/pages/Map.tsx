import { useEffect, useMemo, useRef, useState } from 'react';
import { LocateFixed, MapPin, WifiOff } from 'lucide-react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import MapLegend from '../components/MapLegend';
import MapInfoPanel from '../components/MapInfoPanel';
import ConnectionStatus from '../components/ConnectionStatus';
import { usePredictions } from '../hooks/usePredictions';
import { useLocation } from '../hooks/useLocation';
import { useSocket } from '../context/SocketContext';
import { getPrediction, ApiError } from '../services/api';
import { locationKey, normalizeCoords } from '../hooks/helpers';
import { riskColors } from '../utils/risk';
import type { Prediction } from '../types';

const DEFAULT_CENTER: [number, number] = [40, 0];
const DEFAULT_ZOOM = 2;
const USER_ZOOM = 6;

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function popupHtml(prediction: Prediction): string {
  const { fireProbability, riskLevel, indices, weather } = prediction;
  const lines = [
    `<div class="marker-popup">`,
    `<div class="marker-popup-title">${prediction.name ?? 'Location'}</div>`,
    `<div class="marker-popup-risk" style="color:${riskColors[riskLevel]}">${riskLevel} Risk · ${fireProbability}%</div>`,
    `<div class="marker-popup-row"><span>Fire Probability</span><b>${fireProbability}%</b></div>`,
    `<div class="marker-popup-row"><span>FWI</span><b>${indices.FWI}</b></div>`,
    `<div class="marker-popup-row"><span>Temperature</span><b>${weather.temperature}°C</b></div>`,
    `<div class="marker-popup-row"><span>Humidity</span><b>${weather.humidity}%</b></div>`,
    `<div class="marker-popup-row"><span>Wind Speed</span><b>${weather.windSpeed} km/h</b></div>`,
    `<div class="marker-popup-row"><span>Last Updated</span><b>${formatTime(prediction.predictedAt)}</b></div>`,
    `</div>`,
  ];
  return lines.join('');
}

export default function MapPage() {
  const mapRef = useRef<L.Map | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const layersRef = useRef<Map<string, L.CircleMarker>>(new Map());
  const pulseTimersRef = useRef<Map<string, number>>(new Map());

  const { list, byKey, upsert, loading, error } = usePredictions();
  const { setMonitoredArea } = useSocket();
  const location = useLocation();

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const userKey = useMemo(
    () => (location.coords ? locationKey(location.coords.lat, location.coords.lon) : null),
    [location.coords]
  );

  // Effective selection: the user's area when known, otherwise the newest
  // prediction; a marker click overrides it while it stays valid.
  const effectiveKey = useMemo(() => {
    if (selectedKey && byKey.has(selectedKey)) return selectedKey;
    if (userKey && byKey.has(userKey)) return userKey;
    const fallback = list[0];
    return fallback ? locationKey(fallback.latitude, fallback.longitude) : null;
  }, [selectedKey, byKey, userKey, list]);

  const info = useMemo(() => {
    if (!effectiveKey) return null;
    const prediction = byKey.get(effectiveKey);
    if (!prediction) return null;
    return {
      location: prediction.name ?? 'Unknown area',
      riskLevel: prediction.riskLevel,
      probability: prediction.fireProbability,
      fwi: prediction.indices.FWI,
      temperature: prediction.weather.temperature,
      humidity: prediction.weather.humidity,
      windSpeed: prediction.weather.windSpeed,
      lastUpdated: prediction.predictedAt,
    };
  }, [effectiveKey, byKey]);

  // Init the map once.
  useEffect(() => {
    const layers = layersRef.current;
    if (mapContainerRef.current && !mapRef.current) {
      const map = L.map(mapContainerRef.current, {
        center: DEFAULT_CENTER,
        zoom: DEFAULT_ZOOM,
        zoomControl: false,
      });

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
      }).addTo(map);

      L.control.zoom({ position: 'bottomright' }).addTo(map);
      mapRef.current = map;
    }

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        layers.clear();
      }
    };
  }, []);

  // Sync markers with the live prediction store — in place, no reload.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const seen = new Set<string>();

    for (const prediction of list) {
      const key = locationKey(prediction.latitude, prediction.longitude);
      seen.add(key);
      const { lat, lon } = normalizeCoords(prediction.latitude, prediction.longitude);
      const color = riskColors[prediction.riskLevel] ?? riskColors.Low;

      let layer = layersRef.current.get(key);
      if (!layer) {
        layer = L.circleMarker([lat, lon], {
          radius: 12,
          fillColor: color,
          color: '#fff',
          weight: 2,
          opacity: 1,
          fillOpacity: 0.85,
        })
          .bindPopup(popupHtml(prediction))
          .addTo(map);
        layer.on('click', () => setSelectedKey(key));
        layersRef.current.set(key, layer);
      } else {
        const changed =
          layer.getLatLng().lat !== lat ||
          layer.getLatLng().lng !== lon ||
          (layer.options as { fillColor?: string }).fillColor !== color;
        if (changed) {
          layer.setLatLng([lat, lon]);
          layer.setStyle({ fillColor: color });
          // Animate only the changed marker.
          const timer = window.setTimeout(() => {
            if (layersRef.current.get(key)) {
              layersRef.current.get(key)?.setRadius(12);
            }
            pulseTimersRef.current.delete(key);
          }, 450);
          const prev = pulseTimersRef.current.get(key);
          if (prev) window.clearTimeout(prev);
          pulseTimersRef.current.set(key, timer);
          layer.setRadius(17);
        }
        layer.setPopupContent(popupHtml(prediction));
      }
    }

    // Remove markers that no longer exist.
    for (const [key, layer] of layersRef.current) {
      if (!seen.has(key)) {
        map.removeLayer(layer);
        layersRef.current.delete(key);
      }
    }
  }, [list]);

  // Center on the user when GPS resolves (and re-subscribe the area).
  useEffect(() => {
    if (!location.coords) return;
    const map = mapRef.current;
    const { lat, lon } = normalizeCoords(location.coords.lat, location.coords.lon);
    setMonitoredArea(lat, lon);
    if (map) {
      map.flyTo([lat, lon], USER_ZOOM, { duration: 1.2 });
    }

    // Refresh the user's own prediction; merge straight into the store.
    const key = locationKey(lat, lon);
    if (byKey.has(key)) return;
    (async () => {
      try {
        const prediction = await getPrediction(lat, lon, true);
        upsert(prediction);
      } catch (err) {
        setFetchError(
          err instanceof ApiError ? err.message : 'Could not fetch your local prediction.'
        );
      }
    })();
  }, [location.coords, setMonitoredArea, byKey, upsert]);

  const handleGPS = () => {
    if (!location.enabled) {
      location.enableLocation();
    }
    void location.requestLocation();
  };

  return (
    <div className="page map-page">
      <div
        ref={mapContainerRef}
        className="map-container"
        role="application"
        aria-label="Wildfire risk map"
      />

      {(error || fetchError) && (
        <div className="error-banner map-banner" role="alert">
          <WifiOff size={18} aria-hidden="true" />
          <span>{error ?? fetchError}</span>
        </div>
      )}

      {location.status === 'denied' && (
        <div className="location-banner map-banner" role="note">
          <MapPin size={18} aria-hidden="true" />
          <div>
            <strong>Location access denied.</strong>
            <span>Enable it in your browser or in Settings to see your local risk.</span>
          </div>
          <button
            type="button"
            className="location-banner-btn"
            onClick={() => location.enableLocation()}
          >
            Enable location
          </button>
        </div>
      )}

      <ConnectionStatus />
      <MapLegend />
      {info && <MapInfoPanel info={info} />}

      <button
        className="map-gps-btn"
        onClick={handleGPS}
        type="button"
        aria-label="Locate my position"
        title={location.enabled ? 'Center on my position' : 'Enable location access'}
      >
        <LocateFixed size={22} />
      </button>

      {loading && (
        <div className="map-loading" role="status" aria-live="polite">
          <span className="spinner" aria-hidden="true" />
          <span>Loading predictions…</span>
        </div>
      )}
    </div>
  );
}

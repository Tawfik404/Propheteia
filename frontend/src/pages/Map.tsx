import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { LocateFixed, MapPin, WifiOff } from 'lucide-react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import MapLegend from '../components/MapLegend';
import MapInfoPanel from '../components/MapInfoPanel';
import MapSearchBar from '../components/MapSearchBar';
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
/** Pause after the map stops moving before requesting the new viewport. */
const MOVEEND_DEBOUNCE_MS = 400;
/** Individual markers below this zoom; clustered above it. */
const CLUSTER_DISABLE_ZOOM = 11;

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

function titleFor(prediction: Prediction): string {
  return (
    prediction.name ??
    `${prediction.latitude.toFixed(2)}, ${prediction.longitude.toFixed(2)}`
  );
}

function popupHtml(prediction: Prediction): string {
  const { fireProbability, riskLevel, indices, weather } = prediction;
  const lines = [
    `<div class="marker-popup">`,
    `<div class="marker-popup-title">${titleFor(prediction)}</div>`,
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
  const clusterRef = useRef<L.MarkerClusterGroup | null>(null);
  const layersRef = useRef<Map<string, L.CircleMarker>>(new Map());
  const pulseTimersRef = useRef<Map<string, number>>(new Map());
  const moveTimerRef = useRef<number | null>(null);
  const gpsHandledRef = useRef<string | null>(null);
  const searchHandledRef = useRef(false);

  const [searchParams, setSearchParams] = useSearchParams();

  const { list, byKey, upsert, loading, error, loadRegion } = usePredictions();
  const { setMonitoredArea, subscribeView, unsubscribeView } = useSocket();
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
      location: titleFor(prediction),
      riskLevel: prediction.riskLevel,
      probability: prediction.fireProbability,
      fwi: prediction.indices.FWI,
      temperature: prediction.weather.temperature,
      humidity: prediction.weather.humidity,
      windSpeed: prediction.weather.windSpeed,
      lastUpdated: prediction.predictedAt,
    };
  }, [effectiveKey, byKey]);

  // Load the visible region (predictions + socket subscription) after a
  // short pause, so continuous panning does not spam the backend.
  const scheduleRegionLoad = useCallback(() => {
    if (moveTimerRef.current !== null) window.clearTimeout(moveTimerRef.current);
    moveTimerRef.current = window.setTimeout(() => {
      moveTimerRef.current = null;
      const map = mapRef.current;
      if (!map) return;
      const bounds = map.getBounds();
      const region = {
        north: bounds.getNorth(),
        south: bounds.getSouth(),
        east: bounds.getEast(),
        west: bounds.getWest(),
        zoom: map.getZoom(),
      };
      loadRegion(region);
      subscribeView(region);
    }, MOVEEND_DEBOUNCE_MS);
  }, [loadRegion, subscribeView]);

  // Center on a coordinate, subscribe to its live updates and make sure a
  // prediction exists for it (fetching one on demand if needed).
  const focusArea = useCallback(
    async (lat: number, lon: number) => {
      const { lat: rLat, lon: rLon } = normalizeCoords(lat, lon);
      setFetchError(null);
      setMonitoredArea(rLat, rLon);
      const map = mapRef.current;
      if (map) {
        map.flyTo([rLat, rLon], USER_ZOOM, { duration: 1.2 });
      }

      const key = locationKey(rLat, rLon);
      setSelectedKey(key);
      if (byKey.has(key)) return;

      try {
        const prediction = await getPrediction(rLat, rLon, true);
        upsert(prediction, true);
      } catch (err) {
        setFetchError(
          err instanceof ApiError ? err.message : 'Could not fetch prediction for this area.'
        );
      }
    },
    [setMonitoredArea, byKey, upsert]
  );

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

      // All prediction markers live in one cluster group; individual
      // markers only appear at higher zoom levels.
      const cluster = L.markerClusterGroup({
        maxClusterRadius: 55,
        showCoverageOnHover: false,
        spiderfyOnMaxZoom: false,
        disableClusteringAtZoom: CLUSTER_DISABLE_ZOOM,
        chunkedLoading: true,
        chunkInterval: 40,
      });
      cluster.addTo(map);
      clusterRef.current = cluster;

      map.on('moveend', scheduleRegionLoad);

      mapRef.current = map;
      // Initial viewport load (the map does not fire moveend on boot).
      window.setTimeout(scheduleRegionLoad, 0);
    }

    return () => {
      if (moveTimerRef.current !== null) window.clearTimeout(moveTimerRef.current);
      unsubscribeView();
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        clusterRef.current = null;
        layers.clear();
      }
    };
  }, [scheduleRegionLoad, unsubscribeView]);

  // Sync markers with the live prediction store — in place, no reload.
  // Markers are added/updated/removed individually inside the cluster
  // group, so Leaflet re-clusters instead of redrawing the whole map.
  useEffect(() => {
    const cluster = clusterRef.current;
    if (!cluster) return;

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
          .bindPopup(popupHtml(prediction));
        layer.on('click', () => setSelectedKey(key));
        cluster.addLayer(layer);
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

    // Remove markers that no longer exist (region cache eviction, etc.).
    for (const [key, layer] of layersRef.current) {
      if (!seen.has(key)) {
        cluster.removeLayer(layer);
        layersRef.current.delete(key);
      }
    }
  }, [list]);

  // Center on the user when GPS resolves (once per resolved position, so
  // later prediction updates never yank the map away from the user's view).
  useEffect(() => {
    if (!location.coords) return;
    const { lat, lon } = normalizeCoords(location.coords.lat, location.coords.lon);
    const key = locationKey(lat, lon);
    if (gpsHandledRef.current === key) return;
    gpsHandledRef.current = key;
    void focusArea(lat, lon);
  }, [location.coords, focusArea]);

  // A link from the Alerts page arrives as ?lat=..&lon=..: focus that spot,
  // then clean the URL so a later manual visit doesn't re-apply it.
  const focusAreaRef = useRef(focusArea);
  useEffect(() => {
    focusAreaRef.current = focusArea;
  });

  useEffect(() => {
    if (searchHandledRef.current) return;
    if (!searchParams.has('lat') || !searchParams.has('lon')) return;
    const lat = Number(searchParams.get('lat'));
    const lon = Number(searchParams.get('lon'));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    searchHandledRef.current = true;
    void focusAreaRef.current(lat, lon);
    const timer = window.setTimeout(() => {
      setSearchParams({}, { replace: true });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [searchParams, setSearchParams]);

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
      <MapSearchBar
        onSelect={(result) => void focusArea(result.latitude, result.longitude)}
      />
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

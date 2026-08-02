import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MapInfo, Prediction } from '../types';
import { getPredictionsInBounds, ApiError, type MapRegion } from '../services/api';
import { useSocket } from '../context/SocketContext';
import { locationKey } from './helpers';

/** Cached regions are reused for this long before a pan re-fetches. */
const REGION_CACHE_TTL_MS = 10 * 60 * 1000;
/** Max number of cached regions kept in memory (oldest evicted). */
const REGION_CACHE_MAX = 10;

interface RegionEntry {
  region: MapRegion;
  cellKeys: string[];
  fetchedAt: number;
}

export interface PredictionsState {
  /** Predictions keyed by `lat,lon` (4-decimal key). Only cells that were
   *  actually returned for a viewed region (or explicitly monitored). */
  byKey: Map<string, Prediction>;
  /** All cached predictions. */
  list: Prediction[];
  /** True while a viewport request is in flight. */
  loading: boolean;
  error: string | null;
  /** Key of the region currently being loaded/displayed. */
  activeRegionKey: string | null;
  /** Fetch predictions for the visible region (deduped + cancellable). */
  loadRegion: (region: MapRegion) => void;
  /** Info-panel payload for a location (falls back to the newest). */
  getInfo: (lat: number, lon: number) => MapInfo | null;
  /** Latest prediction for a coordinate (from socket or store). */
  getByLocation: (lat: number, lon: number) => Prediction | null;
  /**
   * Merge a prediction into the store. Pass `monitor=true` for the user's
   * own area so it is never evicted with the region cache.
   */
  upsert: (prediction: Prediction, monitor?: boolean) => void;
}

/** Quantized region key (~11 km buckets) so small pans reuse cached data. */
function regionKey(region: MapRegion): string {
  const q = (value: number) => Math.round(value * 10) / 10;
  return `${Math.floor(region.zoom)}:${q(region.north)}:${q(region.south)}:${q(region.east)}:${q(region.west)}`;
}

/**
 * Live prediction store, viewport-scoped.
 *
 * Data is loaded *only* for the visible map region (see loadRegion): the
 * app never asks for the whole world. Regions are cached in memory and
 * evicted (oldest first) when the cache grows; eviction also drops their
 * cells from `byKey` unless another region or the monitored-area set
 * still references them. Socket updates (`prediction:updated`) arrive
 * already filtered by the server to the subscribed viewport.
 */
export function usePredictions(): PredictionsState {
  const { socket } = useSocket();

  const regionsRef = useRef<Map<string, RegionEntry>>(new Map());
  const byKeyRef = useRef<Map<string, Prediction>>(new Map());
  const monitoredKeysRef = useRef<Set<string>>(new Set());
  const abortRef = useRef<AbortController | null>(null);

  const [byKey, setByKey] = useState<Map<string, Prediction>>(() => new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeRegionKey, setActiveRegionKey] = useState<string | null>(null);

  /** Commit merged maps to refs + React state (single write point). */
  const commit = useCallback((regions: Map<string, RegionEntry>, keys: Map<string, Prediction>) => {
    regionsRef.current = regions;
    byKeyRef.current = keys;
    setByKey(keys);
  }, []);

  const loadRegion = useCallback(
    (region: MapRegion) => {
      const key = regionKey(region);
      const cached = regionsRef.current.get(key);
      if (cached && Date.now() - cached.fetchedAt < REGION_CACHE_TTL_MS) {
        setActiveRegionKey(key);
        setError(null);
        return;
      }

      // Cancel any in-flight request — only the latest one stays active.
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setLoading(true);
      setActiveRegionKey(key);

      void (async () => {
        try {
          const { predictions } = await getPredictionsInBounds(region, controller.signal);

          const cellKeys = predictions.map((p) =>
            locationKey(p.latitude, p.longitude)
          );
          const nextRegions = new Map(regionsRef.current);
          nextRegions.set(key, { region, cellKeys, fetchedAt: Date.now() });

          // Evict the oldest regions beyond the cache cap.
          const evictedCellKeys = new Set<string>();
          if (nextRegions.size > REGION_CACHE_MAX) {
            const sorted = [...nextRegions.entries()].sort(
              (a, b) => a[1].fetchedAt - b[1].fetchedAt
            );
            const toEvict = sorted.slice(0, nextRegions.size - REGION_CACHE_MAX);
            for (const [evictedKey] of toEvict) {
              nextRegions.delete(evictedKey);
              for (const cell of toEvict.find(([k]) => k === evictedKey)?.[1].cellKeys ?? []) {
                evictedCellKeys.add(cell);
              }
            }
          }

          const keptCells = new Set<string>();
          for (const entry of nextRegions.values()) {
            for (const cell of entry.cellKeys) keptCells.add(cell);
          }

          const nextByKey = new Map(byKeyRef.current);
          for (const prediction of predictions) {
            nextByKey.set(locationKey(prediction.latitude, prediction.longitude), prediction);
          }
          for (const cell of evictedCellKeys) {
            if (!keptCells.has(cell) && !monitoredKeysRef.current.has(cell)) {
              nextByKey.delete(cell);
            }
          }

          commit(nextRegions, nextByKey);
          setError(null);
        } catch (err) {
          if (err instanceof DOMException && err.name === 'AbortError') return;
          setError(
            err instanceof ApiError
              ? err.message
              : 'Could not load predictions for this area. Please try again.'
          );
        } finally {
          if (abortRef.current === controller) {
            abortRef.current = null;
            setLoading(false);
          }
        }
      })();
    },
    [commit]
  );

  const upsert = useCallback(
    (prediction: Prediction, monitor = false) => {
      const key = locationKey(prediction.latitude, prediction.longitude);
      if (monitor) monitoredKeysRef.current.add(key);

      const next = new Map(byKeyRef.current);
      if (next.get(key) === prediction) return;
      next.set(key, prediction);
      byKeyRef.current = next;
      setByKey(next);
      setError(null);
    },
    []
  );

  // Live updates: merge socket predictions without touching the rest.
  useEffect(() => {
    if (!socket) return;
    socket.on('prediction:updated', (prediction: Prediction) => upsert(prediction));
    return () => {
      socket.off('prediction:updated', upsert);
    };
  }, [socket, upsert]);

  const list = useMemo(
    () =>
      Array.from(byKey.values()).sort(
        (a, b) => new Date(b.predictedAt).getTime() - new Date(a.predictedAt).getTime()
      ),
    [byKey]
  );

  const getByLocation = useCallback(
    (lat: number, lon: number) => byKey.get(locationKey(lat, lon)) ?? null,
    [byKey]
  );

  const getInfo = useCallback(
    (lat: number, lon: number): MapInfo | null => {
      const prediction = byKey.get(locationKey(lat, lon)) ?? list[0];
      if (!prediction) return null;
      return {
        location: prediction.name ?? `${lat.toFixed(2)}, ${lon.toFixed(2)}`,
        riskLevel: prediction.riskLevel,
        probability: prediction.fireProbability,
        fwi: prediction.indices.FWI,
        temperature: prediction.weather.temperature,
        humidity: prediction.weather.humidity,
        windSpeed: prediction.weather.windSpeed,
        lastUpdated: prediction.predictedAt,
      };
    },
    [byKey, list]
  );

  return { byKey, list, loading, error, activeRegionKey, loadRegion, getInfo, getByLocation, upsert };
}

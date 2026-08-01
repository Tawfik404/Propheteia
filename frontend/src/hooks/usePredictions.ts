import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MapInfo, Prediction } from '../types';
import { getPredictions, ApiError } from '../services/api';
import { useSocket } from '../context/SocketContext';
import { locationKey } from './helpers';

export interface PredictionsState {
  /** Predictions keyed by `lat,lon` (4-decimal key). */
  byKey: Map<string, Prediction>;
  /** All predictions, newest first. */
  list: Prediction[];
  loading: boolean;
  error: string | null;
  /** Info-panel payload for a location (falls back to the newest). */
  getInfo: (lat: number, lon: number) => MapInfo | null;
  /** Latest prediction for a coordinate (from socket or store). */
  getByLocation: (lat: number, lon: number) => Prediction | null;
  /** Merge a prediction into the store (REST responses, socket updates). */
  upsert: (prediction: Prediction) => void;
}

/**
 * Live prediction store.
 *
 * Loads the initial snapshots over REST once, then keeps itself in sync
 * with `prediction:updated` events from the Socket.IO channel — the UI
 * updates in place, without refetching or reloading.
 */
export function usePredictions(): PredictionsState {
  const { socket } = useSocket();
  const [byKey, setByKey] = useState<Map<string, Prediction>>(() => new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loadedRef = useRef(false);

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;

    let cancelled = false;
    (async () => {
      try {
        const { predictions } = await getPredictions();
        if (cancelled) return;
        setByKey((prev) => {
          const next = new Map(prev);
          for (const prediction of predictions) {
            next.set(locationKey(prediction.latitude, prediction.longitude), prediction);
          }
          return next;
        });
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof ApiError
            ? err.message
            : 'Could not load predictions. Please try again.'
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const upsert = useCallback((prediction: Prediction) => {
    setByKey((prev) => {
      const key = locationKey(prediction.latitude, prediction.longitude);
      if (prev.get(key) === prediction) return prev;
      const next = new Map(prev);
      next.set(key, prediction);
      return next;
    });
    setError(null);
  }, []);

  // Live updates: merge socket predictions without touching the rest.
  useEffect(() => {
    if (!socket) return;
    socket.on('prediction:updated', upsert);
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
        location: prediction.name ?? `Location ${lat.toFixed(2)}, ${lon.toFixed(2)}`,
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

  return { byKey, list, loading, error, getInfo, getByLocation, upsert };
}

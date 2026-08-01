import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Alert, Prediction } from '../types';
import { getAlerts, ApiError } from '../services/api';
import { useSocket } from '../context/SocketContext';
import { useSettings } from '../context/SettingsContext';
import { showNotification } from '../services/notifications';
import { distanceKm } from '../services/location';
import { locationKey } from './helpers';

export interface AlertsState {
  nearby: Alert[];
  global: Alert[];
  loading: boolean;
  error: string | null;
  /** Clear a transient error banner after user dismisses it. */
  dismissError: () => void;
}

const NEW_ALERT_HIGHLIGHT_MS = 4000;
const RESOLVED_RETENTION_MS = 60000;
/** Nearby radius, matching the backend's default (km). */
const NEARBY_RADIUS_KM = 600;

/**
 * Live alerts store.
 *
 * Nearby + global alert lists are loaded over REST once (per reference
 * point), then kept in sync via the Socket.IO channel:
 *   alert:new        -> inserted at the top, briefly highlighted, and a
 *                       browser notification fires when enabled
 *   alert:resolved   -> marked as resolved, then pruned
 *   prediction:updated -> existing alerts refresh in place
 *
 * @param reference - user coordinates (or null when GPS is off)
 */
export function useAlerts(reference: { lat: number; lon: number } | null): AlertsState {
  const { socket } = useSocket();
  const { settings } = useSettings();
  const [nearby, setNearby] = useState<Alert[]>([]);
  const [global, setGlobal] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const newTimers = useRef<Map<string, number>>(new Map());

  const markNew = useCallback((id: string) => {
    setNearby((prev) =>
      prev.map((a) => (a.id === id ? { ...a, isNew: true, resolved: false } : a))
    );
    setGlobal((prev) =>
      prev.map((a) => (a.id === id ? { ...a, isNew: true, resolved: false } : a))
    );
    const timer = window.setTimeout(() => {
      setNearby((prev) => prev.map((a) => (a.id === id ? { ...a, isNew: false } : a)));
      setGlobal((prev) => prev.map((a) => (a.id === id ? { ...a, isNew: false } : a)));
      newTimers.current.delete(id);
    }, NEW_ALERT_HIGHLIGHT_MS);
    newTimers.current.set(id, timer);
  }, []);

  // Cleanup highlight timers on unmount.
  useEffect(() => {
    const timers = newTimers.current;
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
      timers.clear();
    };
  }, []);

  // Initial load over REST.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { nearby: nearbyAlerts, global: globalAlerts } = await getAlerts(
          reference?.lat,
          reference?.lon
        );
        if (cancelled) return;
        setNearby(nearbyAlerts);
        setGlobal(globalAlerts);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof ApiError
            ? err.message
            : 'Could not load alerts. Please try again.'
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reference?.lat, reference?.lon]);

  const isNearbyAlert = useCallback(
    (alert: Alert) =>
      !reference || distanceKm(alert.lat, alert.lon, reference.lat, reference.lon) <= NEARBY_RADIUS_KM,
    [reference]
  );

  const upsert = useCallback(
    (prediction: Prediction) => {
      const key = locationKey(prediction.latitude, prediction.longitude);
      const alert: Alert = {
        id: key,
        lat: prediction.latitude,
        lon: prediction.longitude,
        location: prediction.name ?? 'Unknown area',
        country: prediction.name?.split(',')[1]?.trim() ?? null,
        region: prediction.name?.split(',')[0]?.trim() ?? null,
        riskLevel: prediction.riskLevel,
        fireProbability: prediction.fireProbability,
        fwi: prediction.indices.FWI,
        timestamp: prediction.predictedAt,
      };

      // Update the global list in place; only touch the nearby list when
      // the location is actually within the monitored radius.
      setGlobal((prev) => {
        const exists = prev.some((a) => a.id === key);
        return exists ? prev.map((a) => (a.id === key ? { ...alert, ...a } : a)) : prev;
      });
      if (isNearbyAlert(alert)) {
        setNearby((prev) => {
          const exists = prev.some((a) => a.id === key);
          const next = exists ? prev.map((a) => (a.id === key ? { ...alert, ...a } : a)) : [alert, ...prev];
          return next.length > 12 ? next.slice(0, 12) : next;
        });
      }
    },
    [isNearbyAlert]
  );

  const handleNewAlert = useCallback(
    (alert: Alert) => {
      // Insert at the top of the global list and, when nearby, of the
      // nearby list too (dedupe: global + area rooms may deliver the same
      // event); highlight briefly.
      setGlobal((prev) => {
        const rest = prev.filter((a) => a.id !== alert.id);
        return [{ ...alert, isNew: true, resolved: false }, ...rest].slice(0, 12);
      });
      if (isNearbyAlert(alert)) {
        setNearby((prev) => {
          const rest = prev.filter((a) => a.id !== alert.id);
          return [{ ...alert, isNew: true, resolved: false }, ...rest].slice(0, 12);
        });
      }
      markNew(alert.id);

      // Browser notification for nearby alerts when enabled.
      if (settings.notifications && isNearbyAlert(alert)) {
        showNotification(
          `Wildfire alert: ${alert.location}`,
          `${alert.riskLevel} risk · ${alert.fireProbability}% estimated fire probability · FWI ${alert.fwi}`
        );
      }
    },
    [settings.notifications, isNearbyAlert, markNew]
  );

  const handleResolved = useCallback(
    (payload: { lat: number; lon: number; riskLevel?: string }) => {
      const key = locationKey(payload.lat, payload.lon);
      const resolvedAt = Date.now();
      setNearby((prev) =>
        prev.map((a) => (a.id === key ? { ...a, resolved: true, resolvedAt } : a))
      );
      setGlobal((prev) =>
        prev.map((a) => (a.id === key ? { ...a, resolved: true, resolvedAt } : a))
      );
      window.setTimeout(() => {
        setNearby((prev) => prev.filter((a) => !(a.id === key && a.resolved)));
        setGlobal((prev) => prev.filter((a) => !(a.id === key && a.resolved)));
      }, RESOLVED_RETENTION_MS);
    },
    []
  );

  // Live updates.
  useEffect(() => {
    if (!socket) return;
    socket.on('alert:new', handleNewAlert);
    socket.on('alert:resolved', handleResolved);
    socket.on('prediction:updated', upsert);
    return () => {
      socket.off('alert:new', handleNewAlert);
      socket.off('alert:resolved', handleResolved);
      socket.off('prediction:updated', upsert);
    };
  }, [socket, handleNewAlert, handleResolved, upsert]);

  const dismissError = useCallback(() => setError(null), []);

  const result = useMemo(
    () => ({ nearby, global, loading, error, dismissError }),
    [nearby, global, loading, error, dismissError]
  );
  return result;
}

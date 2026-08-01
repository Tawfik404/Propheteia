import { useCallback, useEffect, useRef, useState } from 'react';
import type { LocationStatus } from '../types';
import { useSettings } from '../context/SettingsContext';
import {
  distanceKm,
  getCurrentPosition,
  type Coordinates,
  type LocationError,
} from '../services/location';

export interface LocationState {
  status: LocationStatus;
  coords: Coordinates | null;
  error: LocationError | null;
}

const IDLE: LocationState = { status: 'idle', coords: null, error: null };

/**
 * Geolocation hook.
 *
 * - Reads the persisted "location access" preference.
 * - When enabled, resolves the user's position once and re-resolves when
 *   the user moves more than `moveThresholdKm` from the last fix.
 * - Reports friendly, categorized errors (denied / unavailable / timeout).
 */
export function useLocation(moveThresholdKm = 25) {
  const { settings, enableLocation, disableLocation } = useSettings();
  const [state, setState] = useState<LocationState>(IDLE);
  const coordsRef = useRef<Coordinates | null>(null);
  const resolvingRef = useRef(false);

  const resolve = useCallback(async () => {
    if (resolvingRef.current) return;
    resolvingRef.current = true;
    setState((prev) => ({ ...prev, status: 'prompting', error: null }));
    try {
      const coords = await getCurrentPosition();
      coordsRef.current = coords;
      setState({ status: 'granted', coords, error: null });
    } catch (error) {
      const locationError = error as LocationError;
      setState({
        status: locationError.code === 'denied' ? 'denied' : 'unavailable',
        coords: null,
        error: locationError,
      });
    } finally {
      resolvingRef.current = false;
    }
  }, []);

  // Track the user while location access is enabled.
  useEffect(() => {
    if (!settings.location) {
      coordsRef.current = null;
      return;
    }
    // Deferred so the status transition happens in a callback, not
    // synchronously inside the effect body.
    const initial = window.setTimeout(() => void resolve(), 0);
    const timer = window.setInterval(() => {
      if (coordsRef.current) {
        void resolve();
      }
    }, 120000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [settings.location, resolve]);

  // Re-resolve promptly when the user moves significantly (haversine).
  const effectiveCoords = settings.location ? state.coords : null;
  useEffect(() => {
    if (!settings.location || !effectiveCoords) return;
    const watchId = navigator.geolocation?.watchPosition(
      (position) => {
        const lat = position.coords.latitude;
        const lon = position.coords.longitude;
        const prev = coordsRef.current;
        if (!prev) return;
        if (distanceKm(prev.lat, prev.lon, lat, lon) > moveThresholdKm) {
          void resolve();
        }
      },
      undefined,
      { enableHighAccuracy: true, maximumAge: 30000 }
    );
    return () => {
      if (watchId !== undefined) navigator.geolocation.clearWatch(watchId);
    };
  }, [settings.location, effectiveCoords, moveThresholdKm, resolve]);

  const effectiveState: LocationState = settings.location
    ? state
    : { status: 'idle', coords: null, error: null };

  return {
    ...effectiveState,
    enabled: settings.location,
    enableLocation,
    disableLocation,
    requestLocation: resolve,
  };
}

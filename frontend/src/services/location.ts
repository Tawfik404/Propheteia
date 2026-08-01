/**
 * Browser geolocation helpers.
 */

export interface Coordinates {
  lat: number;
  lon: number;
  /** Horizontal fix accuracy in meters, when reported by the browser. */
  accuracy: number | null;
}

export type LocationError =
  | { code: 'denied'; message: string }
  | { code: 'unavailable'; message: string }
  | { code: 'timeout'; message: string }
  | { code: 'unsupported'; message: string };

const DEFAULT_TIMEOUT_MS = 10000;
const MAX_ACCEPTABLE_ACCURACY_M = 150;

/** Whether the browser exposes the Geolocation API at all. */
export function isGeolocationSupported(): boolean {
  return typeof navigator !== 'undefined' && 'geolocation' in navigator;
}

function toCoordinates(position: GeolocationPosition): Coordinates {
  return {
    lat: position.coords.latitude,
    lon: position.coords.longitude,
    accuracy: Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : null,
  };
}

function mapGeolocationError(error: GeolocationPositionError): LocationError {
  switch (error.code) {
    case error.PERMISSION_DENIED:
      return {
        code: 'denied',
        message: 'Location access was denied. Enable it in your browser settings to see nearby risks.',
      };
    case error.POSITION_UNAVAILABLE:
      return {
        code: 'unavailable',
        message: 'Your position could not be determined. Please try again.',
      };
    case error.TIMEOUT:
      return {
        code: 'timeout',
        message: 'Location request timed out. Please try again.',
      };
    default:
      return {
        code: 'unavailable',
        message: 'An unknown error occurred while locating you.',
      };
  }
}

/**
 * Resolve the user's current position with best-effort accuracy.
 *
 * Listens for fixes until one meets `maxAcceptableAccuracy` (GPS fixes
 * converge over the first seconds), tracking the most accurate fix seen;
 * if the timeout expires first, resolves with the best fix available.
 * Fresh fixes only (`maximumAge: 0`) so a cached position from elsewhere
 * is never reused.
 *
 * @param timeoutMs - max time to wait for a fix
 * @param maxAcceptableAccuracy - meters; resolve early when a fix is this accurate
 * @returns coordinates on success
 * @throws {LocationError} with a friendly, categorized message
 */
export function getCurrentPosition(
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxAcceptableAccuracy = MAX_ACCEPTABLE_ACCURACY_M
): Promise<Coordinates> {
  if (!isGeolocationSupported()) {
    return Promise.reject({
      code: 'unsupported',
      message: 'Location services are not supported by this browser.',
    } as LocationError);
  }

  return new Promise((resolvePromise, rejectPromise) => {
    let settled = false;
    let bestFix: Coordinates | null = null;

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearWatch();
      window.clearTimeout(timer);
      fn();
    };

    const clearWatch = () => {
      if (watchId !== undefined) navigator.geolocation.clearWatch(watchId);
    };

    const timer = window.setTimeout(() => {
      const fix = bestFix;
      if (fix) {
        settle(() => resolvePromise(fix));
      } else {
        settle(() =>
          rejectPromise({
            code: 'timeout',
            message: 'Location request timed out. Please try again.',
          } as LocationError)
        );
      }
    }, timeoutMs);

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        const coords = toCoordinates(position);
        const accuracy = coords.accuracy ?? Number.POSITIVE_INFINITY;
        if (accuracy <= maxAcceptableAccuracy) {
          settle(() => resolvePromise(coords));
          return;
        }
        if (!bestFix || accuracy < (bestFix.accuracy ?? Number.POSITIVE_INFINITY)) {
          bestFix = coords;
        }
      },
      (error) => settle(() => rejectPromise(mapGeolocationError(error))),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 }
    );
  });
}

/** Great-circle distance in km between two coordinates (haversine). */
export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}

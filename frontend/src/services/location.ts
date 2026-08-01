/**
 * Browser geolocation helpers.
 */

export interface Coordinates {
  lat: number;
  lon: number;
}

export type LocationError =
  | { code: 'denied'; message: string }
  | { code: 'unavailable'; message: string }
  | { code: 'timeout'; message: string }
  | { code: 'unsupported'; message: string };

/** Whether the browser exposes the Geolocation API at all. */
export function isGeolocationSupported(): boolean {
  return typeof navigator !== 'undefined' && 'geolocation' in navigator;
}

/**
 * Resolve the user's current position.
 *
 * @param timeoutMs - max time to wait for a fix
 * @returns coordinates on success
 * @throws {LocationError} with a friendly, categorized message
 */
export function getCurrentPosition(timeoutMs = 10000): Promise<Coordinates> {
  if (!isGeolocationSupported()) {
    return Promise.reject({
      code: 'unsupported',
      message: 'Location services are not supported by this browser.',
    } as LocationError);
  }

  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          lat: position.coords.latitude,
          lon: position.coords.longitude,
        });
      },
      (error) => {
        switch (error.code) {
          case error.PERMISSION_DENIED:
            reject({
              code: 'denied',
              message: 'Location access was denied. Enable it in your browser settings to see nearby risks.',
            } as LocationError);
            break;
          case error.POSITION_UNAVAILABLE:
            reject({
              code: 'unavailable',
              message: 'Your position could not be determined. Please try again.',
            } as LocationError);
            break;
          case error.TIMEOUT:
            reject({
              code: 'timeout',
              message: 'Location request timed out. Please try again.',
            } as LocationError);
            break;
          default:
            reject({
              code: 'unavailable',
              message: 'An unknown error occurred while locating you.',
            } as LocationError);
        }
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60000 }
    );
  });
}

/** Rough distance in km between two coordinates (haversine). */
export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}

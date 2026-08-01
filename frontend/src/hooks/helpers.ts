/**
 * Location key helpers shared by the hooks.
 */

/** Stable key for a location (4-decimal precision, matches the backend). */
export function locationKey(lat: number, lon: number): string {
  return `${lat.toFixed(4)},${lon.toFixed(4)}`;
}

/** Normalized coordinates matching the backend cache grid. */
export function normalizeCoords(lat: number, lon: number): { lat: number; lon: number } {
  return { lat: Number(lat.toFixed(4)), lon: Number(lon.toFixed(4)) };
}

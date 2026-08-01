import type { Alert, GeocodeResult, Prediction } from '../types';

/**
 * Backend base URL. Uses Vite's dev proxy (relative path) in development
 * and the same origin in production (Express serves the built app), but
 * allows an absolute override via VITE_API_BASE_URL.
 */
export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '';

/**
 * Error normalized from any REST failure, with a friendly user message.
 */
export class ApiError extends Error {
  status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/**
 * Fetch a JSON resource with a timeout and friendly error mapping.
 *
 * @param path - API path (e.g. "/api/health")
 * @param options - fetch options
 * @returns parsed JSON body
 */
export async function fetchJson<T>(path: string, options: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      signal: controller.signal,
      headers: { Accept: 'application/json', ...options.headers },
    });
  } catch (err) {
    throw new ApiError(
      err instanceof DOMException && err.name === 'AbortError'
        ? 'The server took too long to respond. Please try again.'
        : 'Unable to reach the server. Check your connection and try again.'
    );
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    let detail = '';
    try {
      const body = (await response.json()) as { message?: string };
      detail = body.message ?? '';
    } catch {
      // non-JSON error body: ignore
    }
    throw new ApiError(
      detail || `Request failed with status ${response.status}`,
      response.status
    );
  }

  return (await response.json()) as T;
}

/** Server health check used on startup. */
export function getHealth() {
  return fetchJson<{ status: string; service: string }>('/api/health');
}

/**
 * Fetch a full prediction for a coordinate, optionally registering the
 * location for background monitoring.
 */
export function getPrediction(lat: number, lon: number, monitor = true) {
  const params = new URLSearchParams({ lat: String(lat), lon: String(lon) });
  if (monitor) params.set('monitor', '1');
  return fetchJson<Prediction>(`/api/predict?${params.toString()}`);
}

/** Latest prediction snapshots (map markers + initial state). */
export function getPredictions(limit = 100) {
  return fetchJson<{ count: number; predictions: Prediction[] }>(
    `/api/predictions?limit=${limit}`
  );
}

/** Place-name search for the map search bar. */
export function searchLocations(query: string, limit = 8) {
  const params = new URLSearchParams({ q: query, limit: String(limit) });
  return fetchJson<{ query: string; count: number; results: GeocodeResult[] }>(
    `/api/geocode?${params.toString()}`
  );
}

/** Nearby + global alert lists for a reference point. */
export function getAlerts(lat?: number, lon?: number, radiusKm = 600) {
  const params = new URLSearchParams({ radiusKm: String(radiusKm) });
  if (lat !== undefined && lon !== undefined) {
    params.set('lat', String(lat));
    params.set('lon', String(lon));
  }
  return fetchJson<{
    nearby: Alert[];
    global: Alert[];
    reference: Alert | null;
  }>(`/api/alerts?${params.toString()}`);
}

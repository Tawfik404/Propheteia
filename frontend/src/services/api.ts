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
 * @param options - fetch options; an external AbortSignal is honored
 *        (aborting it cancels the request so a newer one can replace it)
 * @returns parsed JSON body
 */
export async function fetchJson<T>(
  path: string,
  options: RequestInit & { timeoutMs?: number } = {}
): Promise<T> {
  const controller = new AbortController();
  const external = options.signal;
  if (external) {
    if (external.aborted) {
      controller.abort();
    } else {
      external.addEventListener('abort', () => controller.abort(), { once: true });
    }
  }
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 15000);

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

/** A visible map region (leaflet bounds + zoom level). */
export interface MapRegion {
  north: number;
  south: number;
  east: number;
  west: number;
  zoom: number;
}

export interface RegionResponse {
  count: number;
  spacing: number;
  region: MapRegion;
  predictions: Prediction[];
}

/**
 * Predictions for a visible map region only.
 *
 * The backend computes a zoom-dependent grid inside these bounds — it
 * never returns the whole world. Pass an AbortSignal so a newer viewport
 * request can cancel an older, slower one. Region computes take longer
 * than point requests, so the fetch timeout is extended.
 */
export function getPredictionsInBounds(region: MapRegion, signal?: AbortSignal) {
  const params = new URLSearchParams({
    north: String(region.north),
    south: String(region.south),
    east: String(region.east),
    west: String(region.west),
    z: String(region.zoom),
  });
  return fetchJson<RegionResponse>(`/api/predictions?${params.toString()}`, {
    signal,
    timeoutMs: 45000,
  });
}

/**
 * Latest persisted prediction snapshots (newest first).
 *
 * Used for very low map zooms, where a grid computation would span the
 * whole world (the backend refuses those) — the map shows what is already
 * known instead of waiting for a full recompute.
 */
export function getLatestPredictions(limit = 100, signal?: AbortSignal) {
  const params = new URLSearchParams({ limit: String(limit) });
  return fetchJson<RegionResponse>(`/api/predictions?${params.toString()}`, { signal });
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

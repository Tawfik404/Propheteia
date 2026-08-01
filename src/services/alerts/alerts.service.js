import PredictionStore from '../../db/predictionStore.js';
import { predictionService } from '../prediction/prediction.service.js';
import { haversineDistanceKm, locationKey } from '../../utils/geo.js';

/** Risk levels that qualify as an actionable alert. */
export const ALERT_RISK_THRESHOLD = 'High';

const DEFAULT_RADIUS_KM = 600;
const GLOBAL_LIMIT = 8;

/**
 * Build the alert payload for a single prediction.
 *
 * @param {object} prediction - full prediction payload
 * @returns {object} alert-shaped object
 */
function toAlert(prediction) {
  const name = prediction.name || null;
  const [region, country] = splitLocationName(name);

  return {
    id: locationKey(prediction.latitude, prediction.longitude),
    lat: prediction.latitude,
    lon: prediction.longitude,
    location: name ?? 'Unknown area',
    country: country ?? null,
    region: region ?? null,
    riskLevel: prediction.riskLevel,
    fireProbability: prediction.fireProbability,
    fwi: prediction.indices.FWI,
    timestamp: prediction.predictedAt,
  };
}

/**
 * Split a "Region, Country" location name into its parts.
 *
 * @param {string|null} name
 * @returns {[string|null, string|null]}
 */
function splitLocationName(name) {
  if (!name) return [null, null];
  const parts = name.split(',').map((p) => p.trim());
  if (parts.length >= 2) return [parts[0], parts[parts.length - 1]];
  return [name, null];
}

/**
 * AlertsService.
 *
 * Derives the alerts the UI shows from the persisted prediction snapshots:
 *   - nearby: predictions within a radius of a reference point, ordered by
 *     distance (the query point itself is always included),
 *   - global: the most threatening predictions worldwide.
 */
export class AlertsService {
  constructor(store = new PredictionStore(), prediction = predictionService) {
    this.store = store;
    this.prediction = prediction;
  }

  /**
   * Build the nearby + global alert lists.
   *
   * @param {object} [options]
   * @param {number} [options.lat] - reference latitude (optional)
   * @param {number} [options.lon] - reference longitude (optional)
   * @param {number} [options.radiusKm=600] - nearby radius
   * @returns {Promise<{ nearby: Array, global: Array, reference: object|null }>}
   */
  async getAlerts({ lat = null, lon = null, radiusKm = DEFAULT_RADIUS_KM } = {}) {
    const radius = Number.isFinite(Number(radiusKm)) && Number(radiusKm) > 0
      ? Number(radiusKm)
      : DEFAULT_RADIUS_KM;

    const predictions = this.store.recent(100);

    // The reference point's own prediction (computed live, weather cached
    // upstream) so the user always sees an alert for their own area.
    let reference = null;
    if (lat !== null && lon !== null) {
      try {
        reference = await this.prediction.predict(lat, lon);
      } catch {
        reference = null; // weather provider unavailable: fall back to store
      }
    }

    const all = reference ? [reference, ...predictions] : predictions;
    const seen = new Set();
    const unique = all.filter((p) => {
      const key = locationKey(p.latitude, p.longitude);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const nearby = [];
    if (reference) {
      const refKey = locationKey(reference.latitude, reference.longitude);
      for (const p of unique) {
        const key = locationKey(p.latitude, p.longitude);
        if (key === refKey) {
          nearby.push({ ...toAlert(p), distanceKm: 0 });
          continue;
        }
        const distanceKm = haversineDistanceKm(
          reference.latitude, reference.longitude,
          p.latitude, p.longitude
        );
        if (distanceKm <= radius) {
          nearby.push({ ...toAlert(p), distanceKm: Math.round(distanceKm) });
        }
      }
      nearby.sort((a, b) => a.distanceKm - b.distanceKm);
    }

    const global = unique
      .filter((p) => p.fireProbability > 0)
      .sort((a, b) => b.fireProbability - a.fireProbability)
      .slice(0, GLOBAL_LIMIT)
      .map(toAlert);

    return {
      nearby,
      global,
      reference: reference ? toAlert(reference) : null,
    };
  }
}

/** Singleton alerts service for the application. */
export const alertsService = new AlertsService();

export default alertsService;

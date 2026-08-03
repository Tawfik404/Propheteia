import { getDatabase } from '../../db/database.js';
import PredictionStore from '../../db/predictionStore.js';
import { ReverseGeocodeProvider } from './reverseGeocode.provider.js';
import { NominatimProvider } from './nominatim.provider.js';
import { locationKey } from '../../utils/geo.js';
import { eventBus } from '../../utils/eventBus.js';
import logger from '../../utils/logger.js';
import {
  NAMING_CACHE_TTL_DAYS,
  NAMING_BATCH_CAP,
  NAMING_CONCURRENCY,
  NAMING_REQUEST_INTERVAL_MS,
  NAMING_RETRY_BASE_MS,
  NAMING_MAX_ATTEMPTS,
  NAMING_QUEUE_LIMIT,
} from '../../config/constants.js';

/** Photon feature types Photon emits for settlements. */
const PLACE_TYPES = new Set([
  'city',
  'town',
  'village',
  'municipality',
  'hamlet',
  'locality',
  'borough',
  'suburb',
  'district',
  'quarter',
  'neighbourhood',
]);

/** `osm_value` values treated as recognizable natural/parks features. */
const NATURAL_FEATURES = new Set([
  'national_park',
  'nature_reserve',
  'protected_area',
  'forest',
  'wood',
  'mountain_range',
  'peak',
  'volcano',
  'alpine',
]);

/** Address-hierarchy keys that mean "the point lies inside this place". */
const INSIDE_KEYS = ['city', 'town', 'village', 'municipality', 'locality', 'hamlet'];

/** Cap on in-memory warm cache entries (oldest evicted). */
const MEMORY_CACHE_LIMIT = 10_000;

/**
 * Strip multi-script suffixes from Photon names
 * ("Agadir ⴰⴳⴰⴷⵉⵔ أكادير" -> "Agadir"). Falls back to the raw name
 * when there is no Latin prefix (e.g. CJK-only places).
 *
 * @param {unknown} value
 * @returns {string|null}
 */
function cleanName(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const trimmed = value.trim().replace(/\s+/g, ' ');
  const latinRun = trimmed.match(/^[A-Za-zÀ-ÖØ-öø-ÿ0-9][A-Za-zÀ-ÖØ-öø-ÿ0-9 .'’-]*/);
  const base = latinRun && /[a-zA-Z]/.test(latinRun[0]) ? latinRun[0].trim() : trimmed;
  return base.length > 80 ? base.slice(0, 80).trim() : base;
}

/**
 * Build a ranked list of candidate labels from Photon features.
 *
 * Lower rank wins; the address hierarchy describes places that contain
 * the point (so "In <City>"), while feature-level names are the nearest
 * *nearby* places ("Near <City>"). The ranking mirrors the documented
 * priority: city, town, village, municipality, national park, forest,
 * mountain range, protected area, region, country — with any named
 * feature as a last resort so "Unknown Location" never ships.
 *
 * @param {Array<object>} features - Photon features, nearest first
 * @returns {Array<{rank:number, label:string}>}
 */
export function candidateLabels(features) {
  const out = [];
  const seen = new Set();
  const push = (rank, label) => {
    if (seen.has(label)) return;
    seen.add(label);
    out.push({ rank, label });
  };

  for (const feature of features) {
    const props = feature?.properties ?? {};

    for (const key of INSIDE_KEYS) {
      const name = cleanName(props[key]);
      if (name) push(1, `In ${name}`);
    }

    const ownName = cleanName(props.name);
    if (ownName && PLACE_TYPES.has(props.type)) {
      push(2, `Near ${ownName}`);
    }

    if (ownName && NATURAL_FEATURES.has(props.osm_value)) {
      push(3, `Near ${ownName}`);
    }

    const county = cleanName(props.county);
    if (county) push(4, `Near ${county}`);
    const state = cleanName(props.state);
    if (state) push(5, `Near ${state}`);
    const country = cleanName(props.country);
    if (country) push(6, `Near ${country}`);
    if (ownName) push(7, `Near ${ownName}`);
  }

  out.sort((a, b) => a.rank - b.rank);
  return out;
}

/**
 * Build a label from a Nominatim reverse result.
 *
 * Nominatim reports the place that *contains* the point in its `address`
 * object, so settlement keys mean "In <place>"; the containing county,
 * state and country are "Near" fallbacks, mirroring the same priority
 * used for Photon results.
 *
 * @param {{name: string|null, displayName: string, address: object}} result
 * @returns {string|null}
 */
export function labelFromNominatim(result) {
  const address = result?.address ?? {};
  for (const key of INSIDE_KEYS) {
    const name = cleanName(address[key]);
    if (name) return `In ${name}`;
  }
  const county = cleanName(address.county);
  if (county) return `Near ${county}`;
  const state = cleanName(address.state) ?? cleanName(address.region);
  if (state) return `Near ${state}`;
  const country = cleanName(address.country);
  if (country) return `Near ${country}`;
  const name = cleanName(result?.name);
  if (name) return `Near ${name}`;
  return null;
}

/**
 * LocationNamingService.
 *
 * Turns prediction coordinates into human-readable place labels
 * ("In Agadir", "Near Ifrane", "Near Teton") without ever blocking the
 * prediction pipeline:
 *
 *   1. cached names (SQLite + in-memory) are returned synchronously,
 *   2. up to `cap` misses resolve inline, bounded by a time budget so a
 *      grid computation is never delayed more than a few hundred ms,
 *   3. every remaining miss is queued to a rate-limited background
 *      worker; each successful resolution updates the persisted
 *      prediction and emits `prediction:renamed` so live clients see the
 *      name appear as it arrives,
 *   4. failures are retried with exponential backoff and eventually
 *      dropped — the coordinate is never discarded.
 */
export class LocationNamingService {
  constructor({
    provider = new ReverseGeocodeProvider(),
    fallback = new NominatimProvider(),
    store = new PredictionStore(),
    db = getDatabase(),
    cap = NAMING_BATCH_CAP,
    concurrency = NAMING_CONCURRENCY,
    intervalMs = NAMING_REQUEST_INTERVAL_MS,
  } = {}) {
    this.provider = provider;
    this.fallback = fallback;
    this.store = store;
    this.db = db;
    this.cap = cap;
    this.concurrency = concurrency;
    this.intervalMs = intervalMs;

    this.memory = new Map(); // locationKey -> label
    this.urgent = new Map(); // request-deferred lookups, drained first
    this.pending = new Map(); // back-fill lookups (low priority)
    this.nextStartAt = 0;

    this.#warmMemory();
    this.#enqueueUnnamedPredictions();
    this.#schedulePrune();
  }

  /** True while the background drain loop is running. */
  #draining = false;

  /**
   * Queue names for persisted predictions that never got one.
   *
   * Rows written before reverse geocoding existed (or whose lookups
   * failed) are back-filled in the background, so the alerts lists and
   * global predictions never show a blank location for a valid point.
   *
   * @param {number} [limit=500]
   */
  #enqueueUnnamedPredictions(limit = 500) {
    let rows = [];
    try {
      rows = this.store.unnamed(limit);
    } catch (err) {
      logger.warn(`[naming] could not read unnamed predictions: ${err.message}`);
      return;
    }
    let queued = 0;
    for (const row of rows) {
      const { location_key: key, lat, lon } = row;
      if (this.memory.has(key) || this.pending.has(key) || this.urgent.has(key)) continue;
      this.pending.set(key, { lat, lon, attempt: 0, priority: 'low' });
      queued += 1;
    }
    if (queued > 0) {
      this.#kickDrain();
      logger.info(`[naming] queued ${queued} unnamed predictions for background naming`);
    }
  }

  /**
   * Synchronous cached name lookup (memory, then SQLite).
   *
   * @param {number} lat
   * @param {number} lon
   * @returns {string|null}
   */
  nameFor(lat, lon) {
    const key = locationKey(lat, lon);
    const hit = this.memory.get(key);
    if (hit !== undefined) return hit;

    const row = this.db
      .prepare('SELECT name FROM geocode_cache WHERE location_key = ?')
      .get(key);
    if (row) {
      this.#remember(key, row.name);
      return row.name;
    }
    return null;
  }

  /**
   * Resolve names for many coordinates, awaiting only the fast path.
   *
   * Cache hits resolve synchronously; misses resolve inline up to `cap`
   * with a hard time budget; the remainder are queued to the background
   * worker. The returned map may contain nulls — those coordinates are
   * still being named and will be updated via `prediction:renamed`.
   *
   * @param {Array<{lat:number, lon:number}>} points
   * @param {{cap?: number, timeBudgetMs?: number}} [options]
   * @returns {Promise<Map<string, string|null>>} keyed by locationKey
   */
  async resolveMany(points, { cap = this.cap, timeBudgetMs = 2500 } = {}) {
    const results = new Map();
    const misses = [];

    for (const point of points) {
      const key = locationKey(point.lat, point.lon);
      const cached = this.nameFor(point.lat, point.lon);
      if (cached !== null) {
        results.set(key, cached);
      } else {
        misses.push({ key, lat: point.lat, lon: point.lon });
      }
    }

    if (misses.length === 0) return results;

    const inline = misses.slice(0, cap);
    const deferred = misses.slice(cap);

    for (const point of deferred) this.#enqueue(point, { priority: 'high' });

    if (inline.length > 0) {
      const startedAt = Date.now();
      let index = 0;
      const workers = Array.from({ length: Math.min(this.concurrency, inline.length) }, async () => {
        while (index < inline.length) {
          if (Date.now() - startedAt >= timeBudgetMs) break;
          const point = inline[index];
          index += 1;
          try {
            const label = await this.#fetchLabel(point.lat, point.lon);
            if (label) {
              results.set(point.key, label);
              this.#remember(point.key, label);
            } else {
              results.set(point.key, null);
              this.#enqueue(point);
            }
          } catch (err) {
            logger.warn(
              `[naming] inline lookup failed for (${point.lat}, ${point.lon}): ${err.message}`
            );
            results.set(point.key, null);
            this.#enqueue(point);
          }
        }
      });
      await Promise.all(workers);

      const overBudget = inline.slice(index);
      for (const point of overBudget) this.#enqueue(point);
      if (index < inline.length) {
        logger.info(
          `[naming] time budget hit (${Date.now() - startedAt}ms): deferred ${inline.length - index} of ${inline.length} lookups`
        );
      }
    }

    return results;
  }

  /**
   * Fetch a label from the provider chain (Photon, then Nominatim).
   *
   * Photon covers most of the world; when it returns no features at all
   * (sparse rural coverage), Nominatim — throttled to 1 req/s — fills
   * the gap so a valid coordinate always has a readable name.
   *
   * @param {number} lat
   * @param {number} lon
   * @returns {Promise<string|null>} label or null when nothing is named
   */
  async #fetchLabel(lat, lon) {
    const features = await this.provider.reverse(lat, lon);
    const candidates = candidateLabels(features);
    if (candidates[0]) return candidates[0].label;

    try {
      const result = await this.fallback.reverse(lat, lon);
      return labelFromNominatim(result);
    } catch (err) {
      logger.warn(`[naming] nominatim fallback failed for (${lat}, ${lon}): ${err.message}`);
      return null;
    }
  }

  /** Queue a coordinate for background naming (deduped, bounded). */
  #enqueue(point, { priority = 'low' } = {}) {
    const { key } = point;
    if (this.urgent.has(key) || this.pending.has(key) || this.memory.has(key)) return;
    if (this.urgent.size + this.pending.size >= NAMING_QUEUE_LIMIT) {
      logger.warn(`[naming] queue full; dropping ${key}`);
      return;
    }
    const entry = { lat: point.lat, lon: point.lon, attempt: 0, priority };
    (priority === 'high' ? this.urgent : this.pending).set(key, entry);
    this.#kickDrain();
  }

  /** Start (or ensure) the background drain loop. */
  #kickDrain() {
    if (this.#draining) return;
    this.#draining = true;
    this.#drain().finally(() => {
      this.#draining = false;
    });
  }

  /** Background worker: resolve the queue at a polite, steady pace. */
  async #drain() {
    while (this.urgent.size > 0 || this.pending.size > 0) {
      const wait = this.nextStartAt - Date.now();
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));

      const takeNext = () => {
        const urgentEntry = this.urgent.entries().next().value;
        if (urgentEntry) {
          this.urgent.delete(urgentEntry[0]);
          return urgentEntry;
        }
        const pendingEntry = this.pending.entries().next().value;
        if (pendingEntry) {
          this.pending.delete(pendingEntry[0]);
          return pendingEntry;
        }
        return null;
      };

      const next = takeNext();
      if (!next) break;
      const [key, point] = next;

      try {
        const label = await this.#fetchLabel(point.lat, point.lon);
        if (label) {
          this.#remember(key, label);
          this.#rename(point.lat, point.lon, label);
        } else {
          this.#scheduleRetry(key, point);
        }
      } catch (err) {
        logger.warn(
          `[naming] background lookup failed for (${point.lat}, ${point.lon}) attempt ${point.attempt + 1}: ${err.message}`
        );
        this.#scheduleRetry(key, point);
      }
      this.nextStartAt = Date.now() + this.intervalMs;
    }
  }

  /** Retry with exponential backoff; give up after NAMING_MAX_ATTEMPTS. */
  #scheduleRetry(key, point) {
    const attempt = point.attempt + 1;
    if (attempt >= NAMING_MAX_ATTEMPTS) {
      logger.warn(`[naming] giving up on ${key} after ${attempt} attempts`);
      return;
    }
    const delayMs = Math.min(NAMING_RETRY_BASE_MS * 2 ** (attempt - 1), 10 * 60_000);
    const retry = {
      lat: point.lat,
      lon: point.lon,
      attempt,
      priority: point.priority ?? 'low',
    };
    const queue = retry.priority === 'high' ? this.urgent : this.pending;
    setTimeout(() => {
      if (!this.urgent.has(key) && !this.pending.has(key) && !this.memory.has(key)) {
        queue.set(key, retry);
      }
      this.#kickDrain();
    }, delayMs).unref?.();
  }

  /**
   * Persist a resolved label: update the cache and the stored prediction,
   * then broadcast so live clients can rename the marker.
   */
  #rename(lat, lon, label) {
    try {
      this.store.updateName(lat, lon, label);
    } catch (err) {
      logger.warn(`[naming] could not update stored prediction name: ${err.message}`);
    }
    eventBus.emit('prediction:renamed', { lat, lon, name: label, key: locationKey(lat, lon) });
  }

  /** Warm in-memory cache with the most recently resolved names. */
  #warmMemory() {
    try {
      const rows = this.db
        .prepare(
          'SELECT location_key, name FROM geocode_cache ORDER BY resolved_at DESC LIMIT ?'
        )
        .all(MEMORY_CACHE_LIMIT);
      for (const row of rows) this.memory.set(row.location_key, row.name);
      logger.info(`[naming] warmed ${rows.length} cached location names`);
    } catch (err) {
      logger.warn(`[naming] could not warm name cache: ${err.message}`);
    }
  }

  /** Bound the in-memory cache (FIFO eviction). */
  #remember(key, name) {
    if (this.memory.has(key)) {
      this.memory.set(key, name);
      return;
    }
    this.memory.set(key, name);
    if (this.memory.size > MEMORY_CACHE_LIMIT) {
      const oldest = this.memory.keys().next().value;
      this.memory.delete(oldest);
    }
    try {
      this.db
        .prepare(
          `INSERT INTO geocode_cache (location_key, name, resolved_at)
           VALUES (?, ?, datetime('now'))
           ON CONFLICT(location_key) DO UPDATE SET
             name = excluded.name,
             resolved_at = excluded.resolved_at`
        )
        .run(key, name);
    } catch (err) {
      logger.warn(`[naming] could not cache name for ${key}: ${err.message}`);
    }
  }

  /** Prune expired cache rows once a day (place names change slowly). */
  #schedulePrune() {
    const prune = () => {
      try {
        const removed = this.db
          .prepare('DELETE FROM geocode_cache WHERE resolved_at < datetime(\'now\', ?)')
          .run(`-${NAMING_CACHE_TTL_DAYS} days`).changes;
        if (removed > 0) logger.info(`[naming] pruned ${removed} expired cache rows`);
      } catch (err) {
        logger.warn(`[naming] cache prune failed: ${err.message}`);
      }
    };
    prune();
    const timer = setInterval(prune, 24 * 60 * 60 * 1000);
    timer.unref?.();
  }
}

/** Singleton location naming service for the application. */
export const namingService = new LocationNamingService();

export default namingService;

import LandMaskProvider from './landMask.provider.js';
import WorldCoverProvider from './worldCover.provider.js';
import OsmProvider from './osm.provider.js';
import LandCoverStore from './landCoverStore.js';
import { locationKey, normalizeCoordinates } from '../../utils/geo.js';
import env from '../../config/env.js';
import logger from '../../utils/logger.js';

/**
 * LandCoverService — flammable-terrain filter for the prediction engine.
 *
 * Wildfire predictions must only be generated where an actual land-cover
 * classification confirms combustible vegetation. This service is the
 * single decision point:
 *
 *   1. resolves a classification for every requested coordinate through a
 *      chain of providers (ESA WorldCover 2021 v200 satellite map first,
 *      OpenStreetMap land-use as fallback, coarse static mask opt-in),
 *   2. estimates the vegetated coverage (%) of the surrounding area,
 *   3. applies the configurable vegetation threshold — a cell only
 *      generates a prediction when its coverage is high enough,
 *   4. hard-excludes water, ice and bare surfaces regardless of coverage,
 *   5. caches every classification per grid cell id (SQLite, persisted)
 *      so repeated viewports never re-query the providers.
 *
 * The pipeline order is enforced by the callers: land-cover filtering
 * happens BEFORE any weather or FWI calculation, so non-flammable cells
 * never consume weather API requests or CPU time.
 *
 * The provider interface (`classify(points) -> Map<key, info|null>`) is
 * deliberately narrow so further environmental datasets (NDVI, EVI, soil
 * moisture, fuel models, biomass density, burn scars…) can be added as
 * additional providers or refinement layers without touching the
 * prediction pipeline.
 */

/** Max in-memory cached classifications (simple bound, oldest dropped). */
const MEMORY_CACHE_MAX = 50_000;

/** Adapter exposing the static land mask through the provider contract. */
class MaskProviderAdapter {
  constructor(mask, allowFallback) {
    this.mask = mask;
    this.allowFallback = allowFallback;
  }

  async classify(points) {
    if (!this.allowFallback) return new Map();
    const results = new Map();
    for (const point of points) {
      const onLand = this.mask.isLand(point.lat, point.lon);
      results.set(locationKey(point.lat, point.lon), {
        lat: point.lat,
        lon: point.lon,
        classId: null,
        type: 'Land (unclassified)',
        vegetationCoverage: null,
        water: !onLand,
        source: 'land-mask',
        sampledAt: new Date().toISOString(),
      });
    }
    return results;
  }
}

/** Build the configured provider chain from env settings. */
function buildProviders() {
  const providers = [];
  for (const name of env.landCoverProviders) {
    if (name === 'worldcover') {
      providers.push({
        name,
        provider: new WorldCoverProvider({
          baseUrl: env.worldCoverBaseUrl,
          timeoutMs: env.worldCoverTimeoutMs,
          concurrency: env.worldCoverConcurrency,
          retries: env.worldCoverRetries,
        }),
      });
    } else if (name === 'osm') {
      providers.push({
        name,
        provider: new OsmProvider({
          endpoint: env.osmOverpassUrl,
          timeoutMs: env.osmOverpassTimeoutMs,
        }),
      });
    } else if (name === 'mask') {
      providers.push({
        name,
        provider: new MaskProviderAdapter(new LandMaskProvider(), env.landCoverAllowMaskFallback),
      });
    } else {
      logger.warn(`[landcover] unknown provider "${name}" in LAND_COVER_PROVIDERS, ignored`);
    }
  }
  return providers;
}

export class LandCoverService {
  constructor({
    providers = null,
    store = new LandCoverStore(),
    maskProvider = new LandMaskProvider(),
    minVegetationPct = env.landCoverMinVegetationPct,
    optionalMinPct = env.landCoverOptionalMinPct,
    allowOptional = env.landCoverAllowOptional,
    defaultRadiusM = env.landCoverSampleRadiusM,
    minRadiusM = env.landCoverSampleMinRadiusM,
    maxRadiusM = env.landCoverSampleMaxRadiusM,
    cacheTtlMs = env.landCoverCacheTtlDays * 86_400_000,
    allowMaskFallback = env.landCoverAllowMaskFallback,
  } = {}) {
    this.providers = providers ?? buildProviders();
    this.store = store;
    this.maskProvider = maskProvider;
    this.minVegetationPct = minVegetationPct;
    this.optionalMinPct = optionalMinPct;
    this.allowOptional = allowOptional;
    this.defaultRadiusM = defaultRadiusM;
    this.minRadiusM = minRadiusM;
    this.maxRadiusM = maxRadiusM;
    this.cacheTtlMs = cacheTtlMs;
    this.allowMaskFallback = allowMaskFallback;
    this.memory = new Map();
  }

  /**
   * Whether a coordinate is on land (static mask, no I/O, no network).
   *
   * Used by the grid engine to place prediction points inside cells; the
   * flammability decision itself is classification-based (see
   * `classifyBatch`).
   *
   * @param {number} lat
   * @param {number} lon
   * @returns {boolean}
   */
  isLand(lat, lon) {
    return this.maskProvider.isLand(lat, lon);
  }

  /**
   * Whether a coordinate can support a wildfire.
   *
   * Best-effort synchronous check backed by cached classifications;
   * `false` when the terrain is unknown (no cached data, providers not
   * consulted). Callers that need a fresh decision must use `classify` /
   * `classifyBatch`.
   *
   * @param {number} lat
   * @param {number} lon
   * @returns {boolean}
   */
  isBurnable(lat, lon) {
    const info = this.#cachedOrNull(lat, lon);
    if (info) return info.flammable;
    if (this.allowMaskFallback) return this.maskProvider.isLand(lat, lon);
    return false;
  }

  /**
   * Whether a coordinate is on water (cached classification or mask).
   *
   * @param {number} lat
   * @param {number} lon
   * @returns {boolean}
   */
  isWater(lat, lon) {
    if (!this.maskProvider.isLand(lat, lon)) return true;
    const info = this.#cachedOrNull(lat, lon);
    return info ? info.water : false;
  }

  /**
   * Classify a single coordinate.
   *
   * @param {number} lat
   * @param {number} lon
   * @param {object} [options]
   * @param {number} [options.radiusM] - coverage sample radius (metres)
   * @returns {Promise<object>} full classification info
   */
  async classify(lat, lon, { radiusM } = {}) {
    const { byKey } = await this.classifyBatch([{ lat, lon, radiusM }]);
    return byKey.get(locationKey(lat, lon));
  }

  /**
   * Classify a batch of coordinates (deduplicated).
   *
   * Pipeline step for the grid engine: every point is classified BEFORE
   * weather/FWI work, and only `flammable` points are kept.
   *
   * @param {Array<{lat:number, lon:number, radiusM?:number}>} points
   * @returns {Promise<{byKey: Map<string, object>, total: number, failures: number}>}
   */
  async classifyBatch(points) {
    const unique = [];
    const seen = new Set();
    for (const point of points) {
      if (!Number.isFinite(point.lat) || !Number.isFinite(point.lon)) continue;
      const key = locationKey(point.lat, point.lon);
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push({ ...point, radiusM: this.#clampRadius(point.radiusM) });
    }

    const byKey = new Map();
    const missing = [];
    for (const point of unique) {
      const key = locationKey(point.lat, point.lon);
      const cached = this.#cachedOrNull(point.lat, point.lon);
      if (cached) {
        byKey.set(key, cached);
      } else {
        missing.push(point);
      }
    }

    if (missing.length > 0) {
      const resolved = await this.#resolveThroughChain(missing);
      for (const point of missing) {
        const key = locationKey(point.lat, point.lon);
        let info = resolved.get(key);
        if (!info) {
          info = {
            lat: point.lat,
            lon: point.lon,
            classId: null,
            type: 'Unavailable',
            vegetationCoverage: null,
            water: false,
            source: 'unavailable',
            sampledAt: new Date().toISOString(),
          };
        }
        info = this.#finalize(info);
        byKey.set(key, info);
        // Transient failures are not cached; real classifications are.
        if (!info.source.includes('unavailable')) {
          this.memory.set(key, info);
          this.#storeEntry(info);
        }
      }
    }

    const failures = unique.filter(
      (point) => byKey.get(locationKey(point.lat, point.lon))?.source.includes('unavailable')
    ).length;

    return { byKey, total: unique.length, failures };
  }

  /** Run the missing points through the provider chain (first hit wins). */
  async #resolveThroughChain(points) {
    const resolved = new Map();
    let remaining = points;
    for (const { name, provider } of this.providers) {
      if (remaining.length === 0) break;
      try {
        const results = await provider.classify(remaining);
        const consumed = [];
        for (const point of remaining) {
          const key = locationKey(point.lat, point.lon);
          const info = results.get(key);
          // Transient "unavailable" results are not consumed: the next
          // provider still gets a chance to classify the point.
          if (info && !info.source.includes('unavailable')) {
            resolved.set(key, info);
            consumed.push(key);
          }
        }
        if (consumed.length > 0) {
          remaining = remaining.filter(
            (point) => !consumed.includes(locationKey(point.lat, point.lon))
          );
        }
      } catch (err) {
        logger.warn(`[landcover] provider "${name}" failed: ${err.message?.slice(0, 120)}`);
      }
    }
    return resolved;
  }

  /**
   * Apply the flammability rules to a raw provider classification.
   *
   *   - water, ice, bare surfaces: never flammable,
   *   - otherwise: flammable when vegetation coverage meets the
   *     configured threshold (with an optional 20-40% band),
   *   - the built-up class follows the same coverage rule, which is what
   *     makes urban cells eligible only when adjacent to vegetation.
   */
  #finalize(info) {
    const finalized = { ...info };
    if (info.water) {
      finalized.flammable = false;
    } else if (info.source === 'land-mask') {
      // Opt-in coarse last resort (LAND_COVER_ALLOW_MASK_FALLBACK):
      // the static mask cannot measure vegetation, so any land stands
      // in for burnable terrain.
      finalized.flammable = true;
    } else if (!Number.isFinite(info.vegetationCoverage)) {
      finalized.flammable = false;
    } else if (info.vegetationCoverage >= this.minVegetationPct) {
      finalized.flammable = true;
    } else if (
      this.allowOptional &&
      info.vegetationCoverage >= this.optionalMinPct
    ) {
      finalized.flammable = true;
    } else {
      finalized.flammable = false;
    }
    return finalized;
  }

  /** Clamp the sample radius to the configured bounds. */
  #clampRadius(radiusM) {
    const radius = Number.isFinite(Number(radiusM)) ? Number(radiusM) : this.defaultRadiusM;
    return Math.min(Math.max(radius, this.minRadiusM), this.maxRadiusM);
  }

  /** Fresh cached classification from memory or the SQLite store. */
  #cachedOrNull(lat, lon) {
    const key = locationKey(lat, lon);
    const mem = this.memory.get(key);
    if (mem) return mem;

    let stored = null;
    try {
      stored = this.store.get(lat, lon);
    } catch (err) {
      logger.warn(`[landcover] store read failed: ${err.message?.slice(0, 120)}`);
    }
    if (!stored) return null;

    const age = Date.now() - new Date(stored.sampledAt).getTime();
    if (!Number.isFinite(age) || age > this.cacheTtlMs) return null;
    this.#remember(key, stored);
    return stored;
  }

  /** Keep the in-memory cache bounded. */
  #remember(key, info) {
    this.memory.set(key, info);
    if (this.memory.size > MEMORY_CACHE_MAX) {
      for (const oldest of this.memory.keys()) {
        this.memory.delete(oldest);
        if (this.memory.size <= MEMORY_CACHE_MAX) break;
      }
    }
  }

  /** Persist a classification (silently on storage errors). */
  #storeEntry(info) {
    try {
      const { lat, lon } = normalizeCoordinates(info.lat, info.lon);
      this.store.set({ ...info, lat, lon });
    } catch (err) {
      logger.warn(`[landcover] store write failed: ${err.message?.slice(0, 120)}`);
    }
  }
}

/** Singleton land-cover service for the application. */
export const landCoverService = new LandCoverService();

export default landCoverService;

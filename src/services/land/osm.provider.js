import { locationKey } from '../../utils/geo.js';
import logger from '../../utils/logger.js';
import { landCoverClassInfo } from './landCover.classes.js';

/**
 * OpenStreetMap land-use fallback provider (Overpass API).
 *
 * Used only when the primary satellite-based provider (ESA WorldCover)
 * is unreachable. Queries OSM `landuse` / `natural` features around each
 * point and maps the tags onto the ESA WorldCover class scale, so the
 * rest of the pipeline sees one uniform classification vocabulary.
 *
 * Points are grouped into a few Overpass requests (multiple `around`
 * clauses per query); requests are rate-limited with a small concurrency
 * and only element *counts* are used (no geometry), which keeps payloads
 * tiny. When OSM has no data for a coordinate, the provider reports a
 * "no data" result and the next provider in the chain is tried.
 */

/** Default radius (m) of the OSM feature search around a point. */
export const OSM_SEARCH_RADIUS_M = 400;
/** Max points per Overpass request. */
const POINTS_PER_REQUEST = 20;
/** Politeness limits. */
const CONCURRENCY = 2;
const RETRY_DELAY_MS = 1500;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Map OSM tags to an ESA WorldCover class id (or null when unknown).
 * Water/ice/bare/built-up win over vegetation so a quarry or a beach is
 * never mistaken for fuel.
 */
export function osmClassForTags(tags) {
  const natural = tags.natural;
  const landuse = tags.landuse;
  const aeroway = tags.aeroway;

  if (
    natural === 'water' ||
    natural === 'coastline' ||
    natural === 'bay' ||
    natural === 'strait' ||
    landuse === 'reservoir' ||
    landuse === 'basin' ||
    landuse === 'salt_pond'
  ) {
    return 80; // Permanent water
  }
  if (natural === 'glacier' || natural === 'snowfield' || natural === 'ice_shelf') {
    return 70; // Snow and ice
  }
  if (
    natural === 'bare_rock' ||
    natural === 'scree' ||
    natural === 'sand' ||
    natural === 'shingle' ||
    natural === 'mud' ||
    natural === 'stone' ||
    natural === 'rock' ||
    landuse === 'quarry'
  ) {
    return 60; // Bare / sparse vegetation
  }
  if (
    landuse === 'residential' ||
    landuse === 'commercial' ||
    landuse === 'industrial' ||
    landuse === 'retail' ||
    landuse === 'construction' ||
    landuse === 'brownfield' ||
    landuse === 'landfill' ||
    landuse === 'railway' ||
    landuse === 'depot' ||
    landuse === 'garages' ||
    landuse === 'cemetery' ||
    aeroway === 'aerodrome' ||
    aeroway === 'apron' ||
    aeroway === 'runway' ||
    aeroway === 'taxiway'
  ) {
    return 50; // Built-up
  }
  if (natural === 'wood' || natural === 'tree' || landuse === 'forest') {
    return 10; // Tree cover
  }
  if (natural === 'scrub' || natural === 'heath' || natural === 'shrubbery') {
    return 20; // Shrubland
  }
  if (
    natural === 'grassland' ||
    natural === 'fell' ||
    natural === 'steppe' ||
    landuse === 'grass' ||
    landuse === 'meadow' ||
    landuse === 'village_green'
  ) {
    return 30; // Grassland
  }
  if (
    landuse === 'farmland' ||
    landuse === 'orchard' ||
    landuse === 'vineyard' ||
    landuse === 'plant_nursery' ||
    landuse === 'greenhouse_horticulture' ||
    landuse === 'flowerbed' ||
    landuse === 'allotments'
  ) {
    return 40; // Cropland
  }
  if (natural === 'wetland' || natural === 'marsh' || natural === 'reedbed') {
    return 90; // Herbaceous wetland
  }
  if (natural === 'mangrove' || natural === 'mangroves') {
    return 95; // Mangroves
  }
  if (natural === 'tundra' || natural === 'moss' || natural === 'lichen') {
    return 100; // Moss and lichen
  }
  return null;
}

export class OsmProvider {
  /**
   * @param {object} [options]
   * @param {string} [options.endpoint] - Overpass API interpreter URL
   * @param {number} [options.timeoutMs] - per-request timeout
   * @param {number} [options.radiusM] - search radius around each point
   * @param {number} [options.maxAttempts] - retries on transient errors
   */
  constructor({
    endpoint = 'https://overpass-api.de/api/interpreter',
    timeoutMs = 15_000,
    radiusM = OSM_SEARCH_RADIUS_M,
    maxAttempts = 2,
  } = {}) {
    this.endpoint = endpoint;
    this.timeoutMs = timeoutMs;
    this.radiusM = radiusM;
    this.maxAttempts = maxAttempts;
  }

  /**
   * Classify a batch of points.
   *
   * @param {Array<{lat:number, lon:number}>} points
   * @returns {Promise<Map<string, object|null>>} location key -> info or
   *   null when OSM has no usable data for that point
   */
  async classify(points) {
    const results = new Map();
    const chunks = [];
    for (let i = 0; i < points.length; i += POINTS_PER_REQUEST) {
      chunks.push(points.slice(i, i + POINTS_PER_REQUEST));
    }

    let index = 0;
    const workers = Array.from({ length: Math.min(CONCURRENCY, chunks.length) }, async () => {
      while (index < chunks.length) {
        const chunk = chunks[index];
        index += 1;
        await this.#classifyChunk(results, chunk);
      }
    });
    await Promise.all(workers);
    return results;
  }

  async #classifyChunk(results, points) {
    let response = null;
    for (let attempt = 0; attempt < this.maxAttempts; attempt += 1) {
      response = await this.#query(points);
      if (response) break;
      await sleep(RETRY_DELAY_MS * (attempt + 1));
    }

    if (!response) {
      for (const point of points) {
        results.set(locationKey(point.lat, point.lon), null);
      }
      return;
    }

    // Overpass answers with one flat element list per request; without
    // geometry the elements cannot be attributed to a specific point, so
    // the whole chunk shares the dominant classification of its elements.
    // Points within one chunk are far apart and rarely mix, and this
    // provider is a last-resort fallback anyway.
    const counts = new Map();
    for (const element of response) {
      if (!element.tags) continue;
      const clazz = osmClassForTags(element.tags);
      if (clazz === null) continue;
      counts.set(clazz, (counts.get(clazz) ?? 0) + 1);
    }

    if (counts.size === 0) {
      for (const point of points) {
        results.set(locationKey(point.lat, point.lon), null);
      }
      return;
    }

    let dominant = null;
    let max = 0;
    let total = 0;
    let vegetated = 0;
    for (const [clazz, n] of counts) {
      total += n;
      if (n > max) {
        max = n;
        dominant = clazz;
      }
      if (clazz <= 40 || clazz === 90 || clazz === 95 || clazz === 100) vegetated += n;
    }
    const info = landCoverClassInfo(dominant);
    for (const point of points) {
      results.set(locationKey(point.lat, point.lon), {
        lat: point.lat,
        lon: point.lon,
        classId: dominant,
        type: info.type,
        vegetationCoverage: Math.round((vegetated / total) * 100),
        water: dominant === 80,
        source: 'osm',
        sampledAt: new Date().toISOString(),
      });
    }
  }

  /**
   * Run one Overpass query for a set of points.
   *
   * @returns {Promise<Array|null>} elements with tags, or null on failure
   */
  async #query(points) {
    const clauses = points
      .map((p) => {
        const r = Math.round(this.radiusM);
        return `node(around:${r},${p.lat},${p.lon})["natural"];
way(around:${r},${p.lat},${p.lon})["landuse"];
way(around:${r},${p.lat},${p.lon})["natural"];
relation(around:${r},${p.lat},${p.lon})["natural"];`;
      })
      .join('\n');
    const body = `[out:json][timeout:12];(${clauses});out tags;`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ data: body }),
        signal: controller.signal,
      });
      if (!response.ok) {
        logger.warn(`[landcover] osm provider returned ${response.status}`);
        return null;
      }
      const payload = await response.json();
      return Array.isArray(payload.elements) ? payload.elements : [];
    } catch (err) {
      logger.warn(`[landcover] osm provider failed: ${err.message?.slice(0, 120)}`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}

export default OsmProvider;

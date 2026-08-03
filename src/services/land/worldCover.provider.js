import { fromUrl } from 'geotiff';
import { locationKey } from '../../utils/geo.js';
import logger from '../../utils/logger.js';
import { landCoverClassInfo, isVegetatedClass, isWaterClass } from './landCover.classes.js';

/**
 * ESA WorldCover 2021 v200 provider.
 *
 * Queries the official ESA WorldCover 10 m land-cover map (CC-BY-4.0,
 * Sentinel-1/2 based, 11 UN-FAO LCCS classes). The product is distributed
 * as Cloud-Optimized GeoTIFF tiles on ESA's public S3 bucket, one tile per
 * 3° x 3° cell, named after their north-west corner:
 *
 *   ESA_WorldCover_10m_2021_v200_N30W009_Map.tif
 *
 * Every tile is a COG with 6 embedded overviews, so a single point sample
 * only downloads a few small byte ranges (IFD chain + one overview block)
 * instead of the whole ~100 MB tile. Tiles that do not exist (open ocean,
 * polar caps) are treated as water.
 *
 * Each sample reports the dominant land-cover class plus an estimate of
 * the vegetated fraction ("vegetation coverage %") inside a scale-aware
 * neighbourhood window around the point — the same value the vegetation
 * threshold of the prediction pipeline is applied to.
 *
 * Batching: points are grouped by tile, tiles are fetched concurrently
 * (configurable), and opened tiles (including their block caches) are
 * kept in a bounded in-memory cache so repeated viewports never re-download
 * the same ranges. Results are additionally persisted per point by the
 * LandCoverStore.
 */

/** Tile grid size (degrees) and pixel count of the full-resolution layer. */
const TILE_DEGREES = 3;
const TILE_PIXELS = 36000;
const REF_PIXEL_DEGREES = TILE_DEGREES / TILE_PIXELS; // 10 m

/** Approximate sample-window width (pixels) the overview choice targets. */
const TARGET_WINDOW_PX = 48;
/** Minimum half-window in pixels (guards degenerate windows). */
const MIN_HALF_PX = 2;

/** Default sample radius (m) when the caller provides no cell spacing. */
export const DEFAULT_SAMPLE_RADIUS_M = 1000;

/** Earth mean radius of a latitude degree, metres. */
const METERS_PER_DEGREE = 111_320;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 3° x 3° tile key + URL for a coordinate.
 *
 * @param {number} lat
 * @param {number} lon
 * @returns {{key: string, url: string, originX: number, originY: number}}
 */
export function worldCoverTileFor(lat, lon) {
  const latBand = Math.floor(lat / TILE_DEGREES) * TILE_DEGREES;
  const lonBand = Math.floor(lon / TILE_DEGREES) * TILE_DEGREES;
  const latStr = (latBand >= 0 ? 'N' : 'S') + String(Math.abs(latBand)).padStart(2, '0');
  const lonStr = (lonBand >= 0 ? 'E' : 'W') + String(Math.abs(lonBand)).padStart(3, '0');
  return {
    key: `${latStr}${lonStr}`,
    url: `ESA_WorldCover_10m_2021_v200_${latStr}${lonStr}_Map.tif`,
    // Tile geo-origin derived from the naming convention: the north-west
    // corner of the 3° cell (deterministic, no GeoTIFF tag dependency).
    originX: lonBand,
    originY: latBand + TILE_DEGREES,
  };
}

export class WorldCoverProvider {
  /**
   * @param {object} [options]
   * @param {string} [options.baseUrl] - S3 bucket root for the map tiles
   * @param {number} [options.timeoutMs] - per-fetch timeout
   * @param {number} [options.concurrency] - max parallel tiles fetched
   * @param {number} [options.retries] - fetch retries before giving up
   * @param {number} [options.retryDelayMs] - base backoff between retries
   * @param {number} [options.maxTileCache] - bounded in-memory tile cache
   */
  constructor({
    baseUrl = 'https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map',
    timeoutMs = 20_000,
    concurrency = 4,
    retries = 2,
    retryDelayMs = 700,
    maxTileCache = 16,
  } = {}) {
    this.baseUrl = baseUrl;
    this.timeoutMs = timeoutMs;
    this.concurrency = concurrency;
    this.retries = retries;
    this.retryDelayMs = retryDelayMs;
    this.maxTileCache = maxTileCache;
    this.tiles = new Map(); // tileKey -> Promise<opened tile | null>
    this.tileOrder = [];
  }

  /**
   * Classify a batch of points.
   *
   * @param {Array<{lat:number, lon:number, radiusM?:number}>} points
   * @returns {Promise<Map<string, object>>} location key -> classification
   */
  async classify(points) {
    const byTile = new Map();
    for (const point of points) {
      const tile = worldCoverTileFor(point.lat, point.lon);
      if (!byTile.has(tile.key)) byTile.set(tile.key, { tile, points: [] });
      byTile.get(tile.key).points.push(point);
    }

    const results = new Map();
    const keys = [...byTile.keys()];
    let index = 0;
    const workers = Array.from({ length: Math.min(this.concurrency, keys.length) }, async () => {
      while (index < keys.length) {
        const key = keys[index];
        index += 1;
        const { tile, points: tilePoints } = byTile.get(key);
        await this.#classifyTile(results, tile, tilePoints);
      }
    });
    await Promise.all(workers);
    return results;
  }

  /**
   * Classify every point inside a single tile (one tile open, then
   * per-point window reads reusing the tile's block cache).
   */
  async #classifyTile(results, tile, points) {
    const opened = await this.#openTile(tile);
    for (const point of points) {
      const key = locationKey(point.lat, point.lon);
      if (!opened) {
        results.set(key, this.#noData(point, 'esa-worldcover:tile-missing'));
        continue;
      }
      try {
        results.set(key, await this.#sample(opened, tile, point));
      } catch (err) {
        logger.warn(
          `[landcover] worldcover sample failed for (${point.lat}, ${point.lon}): ${err.message?.slice(0, 120)}`
        );
        results.set(key, this.#noData(point, 'esa-worldcover:unavailable'));
      }
    }
  }

  /** Open (or reuse) a tile's GeoTIFF; null when the tile does not exist. */
  async #openTile(tile) {
    const existing = this.tiles.get(tile.key);
    if (existing) return existing;

    const promise = this.#fetchTile(tile);
    this.tiles.set(tile.key, promise);
    this.tileOrder.push(tile.key);
    if (this.tileOrder.length > this.maxTileCache) {
      const oldest = this.tileOrder.shift();
      if (oldest !== tile.key) this.tiles.delete(oldest);
    }
    return promise;
  }

  /** Fetch the tile with existence probe + retries; null when missing. */
  async #fetchTile(tile) {
    for (let attempt = 0; attempt <= this.retries; attempt += 1) {
      try {
        if (!(await this.#tileExists(tile))) return null;
        const tiff = await fromUrl(`${this.baseUrl}/${tile.url}`);
        const count = await tiff.getImageCount();
        const refImage = await tiff.getImage(0);
        return { tiff, count, refWidth: refImage.getWidth(), images: new Map() };
      } catch (err) {
        const last = attempt === this.retries;
        logger.warn(
          `[landcover] worldcover tile ${tile.key} ${last ? 'failed permanently' : `retry ${attempt + 1}`}: ${err.message?.slice(0, 120)}`
        );
        if (last) return null;
        await sleep(this.retryDelayMs * (attempt + 1));
      }
    }
    return null;
  }

  /** Cheap existence probe (status code visible, unlike GeoTIFF errors). */
  async #tileExists(tile) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}/${tile.url}`, {
        method: 'HEAD',
        signal: controller.signal,
      });
      return response.ok || response.status === 206;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Sample one point: pick the overview level that keeps the sample
   * window near TARGET_WINDOW_PX pixels, read the window, and derive
   * the dominant class + vegetated coverage fraction.
   */
  async #sample({ tiff, count, refWidth, images }, tile, point) {
    const radiusDeg = Math.max(0, point.radiusM ?? DEFAULT_SAMPLE_RADIUS_M) / METERS_PER_DEGREE;
    const targetPxDeg = (2 * radiusDeg) / TARGET_WINDOW_PX;

    // Choose the first overview whose pixel size is coarser than the
    // target; fall back to the finest available layer.
    let chosen = null;
    for (let i = 0; i < count; i += 1) {
      let image = images.get(i);
      if (!image) {
        image = await tiff.getImage(i);
        images.set(i, image);
      }
      const scale = image.getWidth() / refWidth;
      const pxDeg = REF_PIXEL_DEGREES / scale;
      chosen = { image, scale, pxDeg };
      if (pxDeg >= targetPxDeg || i === count - 1) break;
    }

    const { image, pxDeg } = chosen;
    const halfPx = Math.max(MIN_HALF_PX, Math.ceil(radiusDeg / pxDeg));
    const cx = Math.round((point.lon - tile.originX) / pxDeg);
    const cy = Math.round((tile.originY - point.lat) / pxDeg);
    const window = [
      Math.max(0, cx - halfPx),
      Math.max(0, cy - halfPx),
      Math.min(image.getWidth(), cx + halfPx + 1),
      Math.min(image.getHeight(), cy + halfPx + 1),
    ];
    if (window[2] <= window[0] || window[3] <= window[1]) {
      return this.#noData(point, 'esa-worldcover:no-data');
    }

    const data = await image.readRasters({ window, samples: [0] });
    const counts = new Map();
    let valid = 0;
    let vegetated = 0;
    for (const value of data[0]) {
      if (value === undefined) continue;
      valid += 1;
      counts.set(value, (counts.get(value) ?? 0) + 1);
      if (isVegetatedClass(value)) vegetated += 1;
    }

    if (valid === 0) {
      return this.#noData(point, 'esa-worldcover:no-data');
    }

    let dominant = null;
    let max = 0;
    for (const [classId, n] of counts) {
      if (n > max) {
        max = n;
        dominant = classId;
      }
    }

    const info = landCoverClassInfo(dominant);
    return {
      lat: point.lat,
      lon: point.lon,
      classId: dominant,
      type: info.type,
      vegetationCoverage: Math.round((vegetated / valid) * 100),
      water: isWaterClass(dominant),
      source: 'esa-worldcover',
      sampledAt: new Date().toISOString(),
    };
  }

  /** Classification for points where no usable data exists. */
  #noData(point, source) {
    return {
      lat: point.lat,
      lon: point.lon,
      classId: null,
      type: 'No data',
      vegetationCoverage: 0,
      water: source === 'esa-worldcover:tile-missing',
      source,
      sampledAt: new Date().toISOString(),
    };
  }
}

export default WorldCoverProvider;

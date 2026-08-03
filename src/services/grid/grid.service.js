import { weatherService } from '../weather/weather.service.js';
import { fwiService } from '../fwi/fwi.service.js';
import { mapFwiToRisk } from '../alerts/risk.mapper.js';
import { landCoverService } from '../land/landCover.service.js';
import { namingService } from '../geocode/locationNaming.service.js';
import { composePrediction } from '../prediction/payload.js';
import PredictionStore from '../../db/predictionStore.js';
import { locationKey } from '../../utils/geo.js';
import { cacheStore } from '../../cache/index.js';
import { eventBus } from '../../utils/eventBus.js';
import logger from '../../utils/logger.js';
import {
  GRID_SPACING_BY_ZOOM,
  GRID_MAX_CELLS,
  GRID_RESULT_TTL_SECONDS,
  GRID_PERSIST_MIN_RISK,
  GRID_POINT_JITTER_FRACTION,
  PREDICTION_STORE_MAX_ROWS,
} from '../../config/constants.js';

/** Local YYYY-MM-DD date for the FWI "today" observation. */
function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

/** Risk rank used to decide whether a grid cell is persisted. */
const RISK_RANK = {
  'Very Low': 0,
  Low: 1,
  Moderate: 2,
  High: 3,
  Extreme: 4,
};

/**
 * Deterministic in-cell point placement.
 *
 * Grid cells are generated as a uniform lattice, but prediction points
 * are *not* placed at the exact lattice nodes: a small pseudo-random
 * offset derived from the cell's lattice indices keeps every point inside
 * its own cell while breaking the perfectly straight rows/columns a
 * pure degree grid produces. Because the offset only depends on the
 * cell indices, the same cell always yields the same point, so
 * predictions stay stable between refreshes and across clients.
 */
const JITTER_RANDOM_SALT = 0x9e3779b9;

/** 32-bit splitmix PRNG — deterministic per (latIndex, lonIndex). */
function splitmix32(state) {
  let t = (state + JITTER_RANDOM_SALT) | 0;
  t = (t + 0x9e3779b9) | 0;
  t = Math.imul(t ^ (t >>> 16), 0x21f0aaad);
  t = Math.imul(t ^ (t >>> 15), 0x735a2d97);
  t = t ^ (t >>> 15);
  return (t >>> 0) / 4294967296;
}

/** Deterministic [0,1) pair for a lattice cell (lat index, lon index). */
function jitterForCell(ci, cj) {
  const seed = (Math.imul(ci + 1013, 2654435761) ^ Math.imul(cj + 733, 1597334677)) | 0;
  return [splitmix32(seed), splitmix32((seed ^ 0x5bd1e995) | 0)];
}

/**
 * Candidate points for a grid cell, ordered by preference.
 *
 * The fully jittered point is preferred; if it is not burnable the
 * candidates fall back to the cell center and single-axis jitters, all
 * strictly inside the cell. `#resolvePoint` picks the first candidate
 * that is on land, so a jitter never drags a prediction into water and
 * the final point is always a valid, stable location.
 *
 * Exported for testing.
 *
 * @param {{lat:number, lon:number, ci:number, cj:number}} cell
 * @param {number} spacing
 * @returns {Array<{lat:number, lon:number}>}
 */
export function candidatePoints(cell, spacing) {
  const [rLat, rLon] = jitterForCell(cell.ci, cell.cj);
  const maxJitter = spacing * GRID_POINT_JITTER_FRACTION;
  const dLat = (rLat - 0.5) * 2 * maxJitter;
  const dLon = (rLon - 0.5) * 2 * maxJitter;
  const round6 = (value) => Number(value.toFixed(6));

  return [
    { lat: round6(cell.lat + dLat), lon: round6(cell.lon + dLon) },
    { lat: cell.lat, lon: cell.lon },
    { lat: round6(cell.lat + dLat), lon: cell.lon },
    { lat: cell.lat, lon: round6(cell.lon + dLon) },
  ];
}

/**
 * GridService — viewport prediction engine.
 *
 * Turns a visible map area into a discrete set of prediction points:
 *
 *   1. generate a geographic grid whose spacing depends on the zoom level
 *      (coarse when zoomed out, fine when zoomed in),
 *   2. keep only cells that intersect land and could actually burn,
 *      placing each prediction point deterministically inside its cell
 *      (jittered, land-safe — no straight rows/columns),
 *   3. fetch weather for the surviving cells in a few batched requests,
 *      in parallel with human-readable place-name resolution,
 *   4. compute the FWI indices per cell,
 *   5. return a compact payload for the viewport, caching the whole
 *      result so repeated/overlapping viewports skip the computation.
 *
 * Cells at or above `GRID_PERSIST_MIN_RISK` are persisted into the
 * prediction store (with a row cap) so they also surface in the alerts
 * lists and reach real-time subscribers; everything else stays ephemeral.
 *
 * The engine never computes points for the entire world: it only ever
 * works on the requested bounds.
 */
export class GridService {
  constructor({
    weather = weatherService,
    fwi = fwiService,
    land = landCoverService,
    names = namingService,
    predictionStore = new PredictionStore(),
    cache = cacheStore,
  } = {}) {
    this.weather = weather;
    this.fwi = fwi;
    this.land = land;
    this.names = names;
    this.predictionStore = predictionStore;
    this.cache = cache;
  }

  /**
   * Grid spacing (degrees) for a zoom level, from GRID_SPACING_BY_ZOOM.
   *
   * @param {number} zoom
   * @returns {number}
   */
  spacingForZoom(zoom) {
    const z = Number.isFinite(zoom) ? Math.floor(zoom) : 4;
    for (const tier of GRID_SPACING_BY_ZOOM) {
      if (z <= tier.maxZoom) return tier.spacing;
    }
    return GRID_SPACING_BY_ZOOM[GRID_SPACING_BY_ZOOM.length - 1].spacing;
  }

  /**
   * Generate grid cell centers inside a region, snapped to the spacing.
   *
   * Each cell also carries its absolute lattice indices (ci, cj), which
   * seed the deterministic in-cell jitter. The indices are derived from
   * the globally aligned lattice origin, so a cell always jitters to the
   * same point no matter which region request produced it.
   *
   * @param {{north:number, south:number, east:number, west:number}} region
   * @param {number} spacing - spacing in degrees
   * @returns {Array<{lat:number, lon:number, ci:number, cj:number}>}
   */
  cells(region, spacing) {
    const out = [];
    const latStart = Math.ceil(region.south / spacing) * spacing;
    const lonStart = Math.floor(region.west / spacing) * spacing;
    const lonEnd = Math.min(region.east, 179.99);
    const latIndexStart = Math.round(latStart / spacing);
    const lonIndexStart = Math.round(lonStart / spacing);
    let ci = latIndexStart;
    for (let lat = latStart; lat <= region.north; lat += spacing, ci += 1) {
      if (lat > 89.99) break;
      let cj = lonIndexStart;
      for (let lon = lonStart; lon <= lonEnd; lon += spacing, cj += 1) {
        out.push({ lat: Number(lat.toFixed(6)), lon: Number(lon.toFixed(6)), ci, cj });
      }
    }
    return out;
  }

  /**
   * Compute predictions for a visible region.
   *
   * The result is cached per zoom + spacing-quantized bounds, so small
   * pans reuse the previous computation instead of re-requesting weather.
   *
   * @param {{north:number, south:number, east:number, west:number, zoom:number}} region
   * @returns {Promise<{count:number, spacing:number, region:object, predictions:object[]}>}
   */
  async computeRegion({ north, south, east, west, zoom }) {
    let spacing = this.spacingForZoom(zoom);
    let cells = this.cells({ north, south, east, west }, spacing);

    // Guard against pathological viewports: coarsen until the cell count
    // fits. Beyond 8° spacing a region is "the whole world" — never
    // compute it, so a map at world zoom stays cheap (it falls back to
    // the latest persisted snapshots client-side).
    while (cells.length > GRID_MAX_CELLS && spacing < 8) {
      spacing *= 2;
      cells = this.cells({ north, south, east, west }, spacing);
    }
    if (cells.length > GRID_MAX_CELLS) {
      return {
        count: 0,
        spacing,
        region: { north, south, east, west, zoom },
        predictions: [],
      };
    }

    const quantize = (value) => Math.round(value / spacing);
    const cacheKey = `grid:${Math.floor(zoom)}:${quantize(north)}:${quantize(south)}:${quantize(east)}:${quantize(west)}`;

    const result = await this.cache.getOrSet(
      cacheKey,
      () => this.#compute(cells, spacing, { north, south, east, west, zoom }),
      GRID_RESULT_TTL_SECONDS
    );

    return result;
  }

  /**
   * Full computation pipeline for a cell set (cache-miss path).
   */
  async #compute(cells, spacing, region) {
    const date = todayDate();
    const month = new Date().getMonth() + 1;

    // 1. Land/burnable filter — no points over ocean, lakes or ice.
    //    Each surviving cell keeps its first land-safe candidate point,
    //    so displayed locations never form perfect grid lines.
    const landCells = [];
    for (const cell of cells) {
      const point = this.#resolvePoint(cell, spacing);
      if (point) landCells.push(point);
    }

    // 2. Weather (batched, cache-aware) and place-name resolution run in
    //    parallel: naming is time-bounded and never blocks the FWI work.
    const namesPromise = this.names.resolveMany(landCells);
    const weatherByKey = await this.weather.getWeatherBatch(landCells);
    const namesByKey = await namesPromise;

    // 3+4. FWI per cell + payload, persisting meaningful cells only.
    const predictions = [];
    const persistRank = RISK_RANK[GRID_PERSIST_MIN_RISK] ?? RISK_RANK.Moderate;
    for (const cell of landCells) {
      const key = locationKey(cell.lat, cell.lon);
      const weather = weatherByKey.get(key);
      if (
        !weather ||
        !Number.isFinite(weather.temperature) ||
        !Number.isFinite(weather.humidity) ||
        !Number.isFinite(weather.windSpeed) ||
        !Number.isFinite(weather.rainfall24h)
      ) {
        continue;
      }

      const indices = this.fwi.computeDaily(weather, {}, { lat: cell.lat, month });
      const risk = mapFwiToRisk(indices.fwi);
      // Names that resolved in the background while weather was still
      // fetching are picked up here; otherwise the async naming queue
      // updates the persisted row via `prediction:renamed`.
      const name = namesByKey.get(key) ?? this.names.nameFor(cell.lat, cell.lon);
      const prediction = composePrediction({
        lat: cell.lat,
        lon: cell.lon,
        weather,
        indices,
        risk,
        date,
        previous: null,
        name,
      });
      predictions.push(prediction);

      if ((RISK_RANK[prediction.riskLevel] ?? 0) >= persistRank) {
        const previousPrediction = this.predictionStore.get(cell.lat, cell.lon);
        this.predictionStore.save(prediction);
        eventBus.emit('prediction:computed', {
          prediction,
          previousRiskLevel: previousPrediction?.riskLevel ?? null,
        });
      }
    }

    // 5. Keep the store bounded.
    this.predictionStore.prune(PREDICTION_STORE_MAX_ROWS);

    const namedCount = predictions.filter((p) => p.name).length;
    logger.info(`[grid] region computed`, {
      cells: cells.length,
      landCells: landCells.length,
      predictions: predictions.length,
      named: namedCount,
      spacing,
    });

    return {
      count: predictions.length,
      spacing,
      region,
      predictions,
    };
  }

  /**
   * Pick the first land-safe candidate point for a grid cell.
   *
   * @param {{lat:number, lon:number, ci:number, cj:number}} cell
   * @param {number} spacing
   * @returns {{lat:number, lon:number}|null} null when no candidate burns
   */
  #resolvePoint(cell, spacing) {
    for (const candidate of candidatePoints(cell, spacing)) {
      if (this.land.isBurnable(candidate.lat, candidate.lon)) return candidate;
    }
    return null;
  }
}

/** Singleton grid service for the application. */
export const gridService = new GridService();

export default gridService;

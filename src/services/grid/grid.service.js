import { weatherService } from '../weather/weather.service.js';
import { fwiService } from '../fwi/fwi.service.js';
import { mapFwiToRisk } from '../alerts/risk.mapper.js';
import { landCoverService } from '../land/landCover.service.js';
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
 * GridService — viewport prediction engine.
 *
 * Turns a visible map area into a discrete set of prediction points:
 *
 *   1. generate a geographic grid whose spacing depends on the zoom level
 *      (coarse when zoomed out, fine when zoomed in),
 *   2. keep only cells that intersect land and could actually burn,
 *   3. fetch weather for the surviving cells in a few batched requests
 *      (cache-aware; only uncached points hit the provider),
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
    predictionStore = new PredictionStore(),
    cache = cacheStore,
  } = {}) {
    this.weather = weather;
    this.fwi = fwi;
    this.land = land;
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
   * @param {{north:number, south:number, east:number, west:number}} region
   * @param {number} spacing - spacing in degrees
   * @returns {Array<{lat:number, lon:number}>}
   */
  cells(region, spacing) {
    const out = [];
    const latStart = Math.ceil(region.south / spacing) * spacing;
    const lonStart = Math.floor(region.west / spacing) * spacing;
    const lonEnd = Math.min(region.east, 179.99);
    for (let lat = latStart; lat <= region.north; lat += spacing) {
      if (lat > 89.99) break;
      for (let lon = lonStart; lon <= lonEnd; lon += spacing) {
        out.push({ lat: Number(lat.toFixed(6)), lon: Number(lon.toFixed(6)) });
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
    const landCells = [];
    for (const cell of cells) {
      if (this.land.isBurnable(cell.lat, cell.lon)) landCells.push(cell);
    }

    // 2. Weather, batched and cache-aware.
    const weatherByKey = await this.weather.getWeatherBatch(landCells);

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
      const prediction = composePrediction({
        lat: cell.lat,
        lon: cell.lon,
        weather,
        indices,
        risk,
        date,
        previous: null,
        name: null,
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

    logger.info(`[grid] region computed`, {
      cells: cells.length,
      landCells: landCells.length,
      predictions: predictions.length,
      spacing,
    });

    return {
      count: predictions.length,
      spacing,
      region,
      predictions,
    };
  }
}

/** Singleton grid service for the application. */
export const gridService = new GridService();

export default gridService;

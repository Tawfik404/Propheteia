import { feature } from 'topojson-client';
import landTopology from 'world-atlas/land-50m.json' with { type: 'json' };

/**
 * Land mask provider built from the public-domain Natural Earth land
 * polygons (distributed via the `world-atlas` package, 1:50M scale).
 *
 * This is a *static* land/water mask: it answers "is this coordinate on
 * land?" from embedded polygons — no external calls, fully offline.
 *
 * Future, richer providers (forests, grasslands, shrublands, agricultural
 * vegetation, permafrost exclusion…) can implement the same `isLand()`
 * contract and replace this provider in `LandCoverService`; the grid
 * engine only depends on the interface.
 *
 * Known limitations (provisional, until a land-cover dataset is added):
 *   - inland lakes are not punched out of the land polygons (a coarse
 *     `WATER_BOXES` exclusion list covers the largest ones),
 *   - no vegetation classification yet: all land is treated as burnable,
 *     except permanent-ice regions (Antarctica) excluded in the service.
 */

/** Rough bounding boxes of major inland water bodies (lat/lon degrees). */
const WATER_BOXES = Object.freeze([
  { name: 'Caspian Sea', north: 47.5, south: 36.5, east: -46.5, west: -54 },
  { name: 'Lake Superior', north: 49.2, south: 46.4, east: -84.0, west: -92.3 },
  { name: 'Lake Michigan', north: 46.1, south: 41.6, east: -84.7, west: -88.1 },
  { name: 'Lake Huron', north: 46.3, south: 43.0, east: -81.0, west: -84.8 },
  { name: 'Lake Baikal', north: 55.9, south: 51.4, east: 110.0, west: 103.6 },
]);

export class LandMaskProvider {
  constructor() {
    const collection = feature(landTopology, landTopology.objects.land);
    // The collection mixes Polygon and MultiPolygon features; flatten them
    // into a single list of polygons (each: array of rings).
    const polygons = [];
    for (const featureGeo of collection.features) {
      const geometry = featureGeo.geometry;
      if (geometry.type === 'Polygon') polygons.push(geometry.coordinates);
      else polygons.push(...geometry.coordinates);
    }
    this.polygons = polygons.map((coordinates) => {
      let minLat = 90;
      let maxLat = -90;
      let minLon = 180;
      let maxLon = -180;
      for (const ring of coordinates) {
        for (const [lon, lat] of ring) {
          if (lat < minLat) minLat = lat;
          if (lat > maxLat) maxLat = lat;
          if (lon < minLon) minLon = lon;
          if (lon > maxLon) maxLon = lon;
        }
      }
      return { coordinates, minLat, maxLat, minLon, maxLon };
    });
  }

  /**
   * Whether a coordinate is on land (static polygons, no I/O).
   *
   * @param {number} lat
   * @param {number} lon
   * @returns {boolean}
   */
  isLand(lat, lon) {
    if (this.#inWaterBox(lat, lon)) return false;
    for (const polygon of this.polygons) {
      if (
        lat < polygon.minLat ||
        lat > polygon.maxLat ||
        lon < polygon.minLon ||
        lon > polygon.maxLon
      ) {
        continue;
      }
      if (this.#inPolygon(lat, lon, polygon.coordinates)) return true;
    }
    return false;
  }

  #inWaterBox(lat, lon) {
    return WATER_BOXES.some(
      (box) => lat <= box.north && lat >= box.south && lon <= box.east && lon >= box.west
    );
  }

  /**
   * Ray-casting point-in-polygon test. A point is inside a polygon when it
   * is inside its outer ring and outside every hole ring.
   */
  #inPolygon(lat, lon, rings) {
    if (!this.#inRing(lat, lon, rings[0])) return false;
    for (let i = 1; i < rings.length; i += 1) {
      if (this.#inRing(lat, lon, rings[i])) return false;
    }
    return true;
  }

  #inRing(lat, lon, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const [lonI, latI] = ring[i];
      const [lonJ, latJ] = ring[j];
      const intersects =
        latI > lat !== latJ > lat &&
        lon < ((lonJ - lonI) * (lat - latI)) / (latJ - latI) + lonI;
      if (intersects) inside = !inside;
    }
    return inside;
  }
}

export default LandMaskProvider;

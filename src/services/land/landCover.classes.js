/**
 * ESA WorldCover 2021 v200 land-cover classification table.
 *
 * The 11 classes are aligned with UN-FAO's Land Cover Classification
 * System (LCCS). This module is the single source of truth for how each
 * class relates to wildfire flammability:
 *
 *   - VEGETATED classes carry combustible fuel (forests, shrubland,
 *     grassland, cropland, herbaceous wetland, mangroves, moss/lichen).
 *   - Built-up is only flammable when it sits adjacent to significant
 *     vegetation (handled by the LandCoverService urban-adjacency rule).
 *   - Bare / sparse vegetation (desert, dunes, rock, salt flats), snow
 *     and ice, and permanent water never carry fuel.
 *
 * New environmental datasets (Copernicus GLCC, MODIS MCD12Q1, Dynamic
 * World, NDVI, EVI, fuel models…) must map their classes onto this same
 * table so the rest of the pipeline never changes.
 */

/** ESA WorldCover v200 class ids. */
export const WORLD_COVER_CLASSES = Object.freeze({
  TREE_COVER: 10,
  SHRUBLAND: 20,
  GRASSLAND: 30,
  CROPLAND: 40,
  BUILT_UP: 50,
  BARE: 60,
  SNOW_ICE: 70,
  PERMANENT_WATER: 80,
  HERBACEOUS_WETLAND: 90,
  MANGROVES: 95,
  MOSS_LICHEN: 100,
});

/**
 * Per-class metadata.
 *
 * @typedef {object} LandCoverClass
 * @property {string} type - human-readable class name (also used in API responses)
 * @property {'vegetated'|'built-up'|'bare'|'ice'|'water'|'unknown'} fuel - fuel category
 */
export const LAND_COVER_CLASSES = Object.freeze({
  10: { type: 'Tree cover', fuel: 'vegetated' },
  20: { type: 'Shrubland', fuel: 'vegetated' },
  30: { type: 'Grassland', fuel: 'vegetated' },
  40: { type: 'Cropland', fuel: 'vegetated' },
  50: { type: 'Built-up', fuel: 'built-up' },
  60: { type: 'Bare / sparse vegetation', fuel: 'bare' },
  70: { type: 'Snow and ice', fuel: 'ice' },
  80: { type: 'Permanent water', fuel: 'water' },
  90: { type: 'Herbaceous wetland', fuel: 'vegetated' },
  95: { type: 'Mangroves', fuel: 'vegetated' },
  100: { type: 'Moss and lichen', fuel: 'vegetated' },
});

/** Class ids whose pixels count as combustible vegetation. */
export const VEGETATED_CLASS_IDS = Object.freeze(
  Object.entries(LAND_COVER_CLASSES)
    .filter(([, meta]) => meta.fuel === 'vegetated')
    .map(([id]) => Number(id))
);

const VEGETATED_SET = new Set(VEGETATED_CLASS_IDS);

/** Whether an ESA WorldCover class id carries combustible vegetation. */
export function isVegetatedClass(classId) {
  return VEGETATED_SET.has(classId);
}

/** Whether an ESA WorldCover class id is a water body. */
export function isWaterClass(classId) {
  return classId === WORLD_COVER_CLASSES.PERMANENT_WATER;
}

/**
 * Metadata for a class id, or the generic unknown entry.
 *
 * @param {number|null} classId
 * @returns {{type: string, fuel: string}}
 */
export function landCoverClassInfo(classId) {
  return LAND_COVER_CLASSES[classId] ?? { type: 'Unknown', fuel: 'unknown' };
}

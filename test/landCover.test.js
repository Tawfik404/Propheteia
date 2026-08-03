import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  worldCoverTileFor,
  WorldCoverProvider,
} from '../src/services/land/worldCover.provider.js';
import { osmClassForTags } from '../src/services/land/osm.provider.js';
import {
  WORLD_COVER_CLASSES,
  LAND_COVER_CLASSES,
  VEGETATED_CLASS_IDS,
  isVegetatedClass,
  isWaterClass,
  landCoverClassInfo,
} from '../src/services/land/landCover.classes.js';
import { LandCoverService } from '../src/services/land/landCover.service.js';
import { locationKey } from '../src/utils/geo.js';

/** Minimal provider stub: returns the given infos for all points. */
function stubProvider(infos = []) {
  const calls = [];
  return {
    calls,
    async classify(points) {
      calls.push(points.length);
      const results = new Map();
      for (const point of points) {
        const base = infos.find((info) => info.lat === point.lat && info.lon === point.lon);
        if (!base || base.usable === false) {
          results.set(locationKey(point.lat, point.lon), null);
          continue;
        }
        results.set(
          locationKey(point.lat, point.lon),
          {
            lat: point.lat,
            lon: point.lon,
            classId: base.classId ?? 10,
            type: base.type ?? 'Tree cover',
            vegetationCoverage: base.vegetationCoverage ?? 0,
            water: base.water ?? false,
            source: base.source ?? 'stub',
            sampledAt: new Date().toISOString(),
          }
        );
      }
      return results;
    },
  };
}

/** No-op store stub (keeps tests hermetic). */
const nullStore = {
  get: () => null,
  set: () => {},
  size: 0,
};

/** Service with stub provider chain, no SQLite, no mask. */
function serviceWith(infos, options = {}) {
  const provider = stubProvider(infos);
  return {
    provider,
    service: new LandCoverService({
      providers: [{ name: 'stub', provider }],
      store: options.store ?? nullStore,
      maskProvider: { isLand: () => true },
      minVegetationPct: 40,
      optionalMinPct: 20,
      allowOptional: false,
      allowMaskFallback: false,
      cacheTtlMs: 86_400_000,
      ...options,
    }),
  };
}

// ---------------------------------------------------------------
// ESA WorldCover tile naming (pure, no network)
// ---------------------------------------------------------------

test('worldCoverTileFor derives tile key, URL and origin from the naming convention', () => {
  const t = worldCoverTileFor(31.63, -8.01);
  assert.equal(t.key, 'N30W009');
  assert.equal(t.url, 'ESA_WorldCover_10m_2021_v200_N30W009_Map.tif');
  assert.equal(t.originX, -9);
  assert.equal(t.originY, 33);

  const equator = worldCoverTileFor(0, 0);
  assert.equal(equator.key, 'N00E000');
  assert.equal(equator.originX, 0);
  assert.equal(equator.originY, 3);

  const south = worldCoverTileFor(-1.5, 2.9);
  assert.equal(south.key, 'S03E000');
  assert.equal(south.originX, 0);
  assert.equal(south.originY, 0);

  const edge = worldCoverTileFor(89.9, 179.9);
  assert.equal(edge.key, 'N87E177');
  assert.equal(edge.originX, 177);
  assert.equal(edge.originY, 90);

  const zurich = worldCoverTileFor(46.7, 7);
  assert.equal(zurich.key, 'N45E006');
  assert.equal(zurich.originX, 6);
  assert.equal(zurich.originY, 48);
});

// ---------------------------------------------------------------
// OSM tag mapping (pure, no network)
// ---------------------------------------------------------------

test('osmClassForTags maps OSM tags onto the ESA class scale', () => {
  assert.equal(osmClassForTags({ natural: 'water' }), 80);
  assert.equal(osmClassForTags({ landuse: 'reservoir' }), 80);
  assert.equal(osmClassForTags({ natural: 'glacier' }), 70);
  assert.equal(osmClassForTags({ natural: 'bare_rock' }), 60);
  assert.equal(osmClassForTags({ landuse: 'quarry' }), 60);
  assert.equal(osmClassForTags({ landuse: 'residential' }), 50);
  assert.equal(osmClassForTags({ aeroway: 'runway' }), 50);
  assert.equal(osmClassForTags({ landuse: 'forest' }), 10);
  assert.equal(osmClassForTags({ natural: 'scrub' }), 20);
  assert.equal(osmClassForTags({ natural: 'grassland' }), 30);
  assert.equal(osmClassForTags({ landuse: 'vineyard' }), 40);
  assert.equal(osmClassForTags({ natural: 'wetland' }), 90);
  assert.equal(osmClassForTags({ natural: 'mangrove' }), 95);
  assert.equal(osmClassForTags({ natural: 'moss' }), 100);
  assert.equal(osmClassForTags({}), null);
  assert.equal(osmClassForTags({ natural: 'peak' }), null);
});

// ---------------------------------------------------------------
// Classification table
// ---------------------------------------------------------------

test('land cover class table is complete and consistent', () => {
  assert.equal(Object.keys(LAND_COVER_CLASSES).length, 11);
  assert.equal(isVegetatedClass(WORLD_COVER_CLASSES.TREE_COVER), true);
  assert.equal(isVegetatedClass(WORLD_COVER_CLASSES.SHRUBLAND), true);
  assert.equal(isVegetatedClass(WORLD_COVER_CLASSES.GRASSLAND), true);
  assert.equal(isVegetatedClass(WORLD_COVER_CLASSES.CROPLAND), true);
  assert.equal(isVegetatedClass(WORLD_COVER_CLASSES.HERBACEOUS_WETLAND), true);
  assert.equal(isVegetatedClass(WORLD_COVER_CLASSES.MANGROVES), true);
  assert.equal(isVegetatedClass(WORLD_COVER_CLASSES.MOSS_LICHEN), true);
  assert.equal(isVegetatedClass(WORLD_COVER_CLASSES.BUILT_UP), false);
  assert.equal(isVegetatedClass(WORLD_COVER_CLASSES.BARE), false);
  assert.equal(isVegetatedClass(WORLD_COVER_CLASSES.SNOW_ICE), false);
  assert.equal(isVegetatedClass(WORLD_COVER_CLASSES.PERMANENT_WATER), false);
  assert.equal(isWaterClass(WORLD_COVER_CLASSES.PERMANENT_WATER), true);
  assert.equal(isWaterClass(WORLD_COVER_CLASSES.BARE), false);

  const ids = new Set(VEGETATED_CLASS_IDS);
  assert.deepEqual(ids, new Set([10, 20, 30, 40, 90, 95, 100]));

  assert.equal(landCoverClassInfo(50).type, 'Built-up');
  assert.equal(landCoverClassInfo(999).type, 'Unknown');
  assert.equal(landCoverClassInfo(null).fuel, 'unknown');
});

// ---------------------------------------------------------------
// Flammability decision engine (LandCoverService, no network)
// ---------------------------------------------------------------

test('vegetation coverage at/above the threshold is flammable', async () => {
  const { service } = serviceWith([
    { lat: 31.63, lon: -8.01, vegetationCoverage: 64, type: 'Shrubland' },
  ]);
  const info = await service.classify(31.63, -8.01);
  assert.equal(info.flammable, true);
  assert.equal(info.type, 'Shrubland');
  assert.equal(info.vegetationCoverage, 64);
});

test('coverage below the threshold is not flammable', async () => {
  const { service } = serviceWith([
    { lat: 30, lon: -9, vegetationCoverage: 10, type: 'Bare / sparse vegetation' },
  ]);
  const info = await service.classify(30, -9);
  assert.equal(info.flammable, false);
});

test('optional 20-40% band only generates when enabled', async () => {
  const point = { lat: 40, lon: 0, vegetationCoverage: 35, type: 'Grassland' };

  const strict = serviceWith([point]);
  assert.equal((await strict.service.classify(40, 0)).flammable, false);

  const permissive = serviceWith([point], { allowOptional: true });
  assert.equal((await permissive.service.classify(40, 0)).flammable, true);
});

test('water is never flammable, even with high coverage', async () => {
  const { service } = serviceWith([
    { lat: 44.5, lon: 50.5, vegetationCoverage: 95, water: true, type: 'Permanent water' },
  ]);
  const info = await service.classify(44.5, 50.5);
  assert.equal(info.water, true);
  assert.equal(info.flammable, false);
});

test('missing coverage is not flammable', async () => {
  const { service } = serviceWith([{ lat: 1, lon: 1, vegetationCoverage: null }]);
  const info = await service.classify(1, 1);
  assert.equal(info.flammable, false);
});

test('provider returning null produces an unavailable result', async () => {
  const { service } = serviceWith([{ lat: 2, lon: 2, usable: false }]);
  const { byKey, failures } = await service.classifyBatch([{ lat: 2, lon: 2 }]);
  const info = byKey.get(locationKey(2, 2));
  assert.equal(info.source, 'unavailable');
  assert.equal(info.flammable, false);
  assert.equal(failures, 1);
});

test('batch dedupes points and reuses cached classifications', async () => {
  const { service, provider } = serviceWith([{ lat: 10, lon: 10, vegetationCoverage: 80 }]);

  const first = await service.classifyBatch([
    { lat: 10, lon: 10 },
    { lat: 10, lon: 10 },
    { lat: 10.0001, lon: 10.0001 }, // same rounded cell
  ]);
  assert.equal(first.total, 2);
  assert.equal(provider.calls[0], 2);

  const second = await service.classifyBatch([{ lat: 10, lon: 10 }]);
  assert.equal(second.total, 1);
  assert.equal(provider.calls.length, 1, 'provider must not be called again');
  assert.equal(second.byKey.get(locationKey(10, 10)).flammable, true);
});

test('isBurnable uses cached classifications synchronously', async () => {
  const { service } = serviceWith([
    { lat: 20, lon: 20, vegetationCoverage: 70 },
    { lat: 21, lon: 21, vegetationCoverage: 5, water: false },
  ]);

  assert.equal(service.isBurnable(20, 20), false, 'unknown terrain is not burnable yet');
  await service.classify(20, 20);
  assert.equal(service.isBurnable(20, 20), true);
  assert.equal(service.isBurnable(21, 21), false);
  assert.equal(service.isBurnable(99, 99), false);
});

test('mask fallback flag gates static-mask classification', async () => {
  const maskProvider = {
    async classify(points) {
      const results = new Map();
      for (const point of points) {
        results.set(locationKey(point.lat, point.lon), {
          lat: point.lat,
          lon: point.lon,
          classId: null,
          type: 'Land (unclassified)',
          vegetationCoverage: null,
          water: false,
          source: 'land-mask',
          sampledAt: new Date().toISOString(),
        });
      }
      return results;
    },
  };
  const stub = stubProvider([{ lat: 5, lon: 5, usable: false }]);

  const noFallback = new LandCoverService({
    providers: [{ name: 'stub', provider: stub }],
    store: nullStore,
    maskProvider: { isLand: () => true },
    minVegetationPct: 40,
    optionalMinPct: 20,
    allowMaskFallback: false,
  });
  const info = await noFallback.classify(5, 5);
  assert.equal(info.source, 'unavailable');

  const withFallback = new LandCoverService({
    providers: [
      { name: 'stub', provider: stub },
      { name: 'mask', provider: maskProvider },
    ],
    store: nullStore,
    maskProvider: { isLand: () => true },
    minVegetationPct: 40,
    optionalMinPct: 20,
    allowMaskFallback: true,
  });
  const masked = await withFallback.classify(5, 5);
  assert.equal(masked.source, 'land-mask');
  assert.equal(masked.flammable, true);
});

test('radius is clamped to the configured bounds', async () => {
  const { service } = serviceWith([
    { lat: 30, lon: 30, vegetationCoverage: 60 },
    { lat: 31, lon: 31, vegetationCoverage: 60 },
  ], {
    defaultRadiusM: 1000,
    minRadiusM: 60,
    maxRadiusM: 2000,
  });
  const { byKey } = await service.classifyBatch([
    { lat: 30, lon: 30, radiusM: 1 },
    { lat: 31, lon: 31, radiusM: 100_000 },
  ]);
  assert.equal(byKey.get(locationKey(30, 30)).flammable, true);
  assert.equal(byKey.get(locationKey(31, 31)).flammable, true);
});

/**
 * Seed monitored locations.
 *
 * On first boot the monitored-locations registry is empty, which would make
 * the map markers and the global predictions list empty until clients start
 * querying the API. Registering a curated set of fire-prone regions (with
 * "Region, Country" names) and computing their initial predictions gives the
 * application real, live data from the very first request.
 *
 * Re-seeding only happens once: subsequent boots find the registry populated
 * and the persisted prediction snapshots are served straight away.
 */
export const SEED_LOCATIONS = Object.freeze([
  { name: 'British Columbia, Canada', lat: 54.0, lon: -124.0 },
  { name: 'California, United States', lat: 36.5, lon: -119.0 },
  { name: 'Oregon, United States', lat: 43.5, lon: -120.5 },
  { name: 'Andalusia, Spain', lat: 37.5, lon: -4.5 },
  { name: 'Attica, Greece', lat: 38.0, lon: 23.7 },
  { name: 'Coimbra, Portugal', lat: 40.2, lon: -8.2 },
  { name: 'Sardinia, Italy', lat: 40.0, lon: 9.0 },
  { name: 'New South Wales, Australia', lat: -33.0, lon: 148.0 },
  { name: 'Victoria, Australia', lat: -37.5, lon: 145.0 },
  { name: 'Valparaíso, Chile', lat: -33.0, lon: -71.5 },
  { name: 'Mato Grosso, Brazil', lat: -12.5, lon: -55.5 },
  { name: 'Western Cape, South Africa', lat: -33.9, lon: 18.6 },
]);

export default SEED_LOCATIONS;

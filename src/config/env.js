import 'dotenv/config';

/**
 * Application configuration.
 *
 * All values are read from environment variables (see `.env.example`)
 * and validated with sensible defaults so the server can boot without
 * any configuration file.
 */

const parseInteger = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const parseBoolean = (value, fallback) => {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
};

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  isProduction: process.env.NODE_ENV === 'production',

  /** HTTP server */
  port: parseInteger(process.env.PORT, 3000),
  host: process.env.HOST || '0.0.0.0',

  /** Logging */
  logLevel: process.env.LOG_LEVEL || 'info',
  logFile: process.env.LOG_FILE || '',

  /** Caching */
  cacheBackend: process.env.CACHE_BACKEND || 'memory', // 'memory' | 'sqlite' | 'both'
  cacheTtlSeconds: parseInteger(process.env.CACHE_TTL_SECONDS, 600),

  /** SQLite persistence */
  dbPath: process.env.DB_PATH || './data/propheteia.db',

  /** Open-Meteo provider */
  openMeteoBaseUrl: process.env.OPEN_METEO_BASE_URL || 'https://api.open-meteo.com',
  openMeteoTimeoutMs: parseInteger(process.env.OPEN_METEO_TIMEOUT_MS, 8000),

  /** Open-Meteo Geocoding provider */
  geocodingBaseUrl: process.env.GEOCODING_BASE_URL || 'https://geocoding-api.open-meteo.com',
  geocodingTimeoutMs: parseInteger(process.env.GEOCODING_TIMEOUT_MS, 6000),

  /** Photon reverse geocoding provider */
  reverseGeocodeBaseUrl: process.env.REVERSE_GEOCODE_BASE_URL || 'https://photon.komoot.io',
  reverseGeocodeTimeoutMs: parseInteger(process.env.REVERSE_GEOCODE_TIMEOUT_MS, 8000),

  /** Nominatim reverse geocoding fallback provider */
  nominatimBaseUrl: process.env.NOMINATIM_BASE_URL || 'https://nominatim.openstreetmap.org',
  nominatimTimeoutMs: parseInteger(process.env.NOMINATIM_TIMEOUT_MS, 8000),
  nominatimUserAgent:
    process.env.NOMINATIM_USER_AGENT ||
    'propheteia-backend/1.0 (wildfire-risk monitoring; https://github.com/Tawfik404/Propheteia)',

  /** Background jobs */
  jobsEnabled: parseBoolean(process.env.JOBS_ENABLED, true),

  /** FWI system */
  fwiStartup: {
    ffmc: parseInteger(process.env.FWI_START_FFMC, 85),
    dmc: parseInteger(process.env.FWI_START_DMC, 6),
    dc: parseInteger(process.env.FWI_START_DC, 15),
  },

  /**
   * Land-cover terrain filtering (wildfire fuel availability).
   *
   * Predictions are only generated where the land-cover classification
   * confirms enough combustible vegetation. Providers are tried in the
   * configured order ('worldcover' = ESA WorldCover 2021 v200 satellite
   * map, 'osm' = OpenStreetMap land-use fallback, 'mask' = coarse static
   * land/water mask, disabled by default because it cannot confirm
   * vegetation).
   */
  landCoverProviders: (process.env.LAND_COVER_PROVIDERS || 'worldcover,osm')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean),

  /** Classification cache lifetime in days (land cover changes yearly). */
  landCoverCacheTtlDays: parseInteger(process.env.LAND_COVER_CACHE_TTL_DAYS, 30),

  /** Minimum vegetation coverage (%) for a cell to generate a prediction. */
  landCoverMinVegetationPct: parseInteger(process.env.LAND_COVER_MIN_VEGETATION_PCT, 40),

  /** Lower edge of the "optional" vegetation band (%); below this = skip. */
  landCoverOptionalMinPct: parseInteger(process.env.LAND_COVER_OPTIONAL_MIN_PCT, 20),

  /** Whether the 20-40% optional band also generates predictions. */
  landCoverAllowOptional: parseBoolean(process.env.LAND_COVER_ALLOW_OPTIONAL, false),

  /**
   * Default sample radius (m) around a prediction point used to estimate
   * vegetation coverage (single-point predictions / fallback radius).
   */
  landCoverSampleRadiusM: parseInteger(process.env.LAND_COVER_SAMPLE_RADIUS_M, 1000),

  /** Min/max radius (m) of the coverage window (clamped per grid zoom). */
  landCoverSampleMinRadiusM: parseInteger(process.env.LAND_COVER_SAMPLE_MIN_RADIUS_M, 60),
  landCoverSampleMaxRadiusM: parseInteger(process.env.LAND_COVER_SAMPLE_MAX_RADIUS_M, 2000),

  /** Whether the static land mask may stand in when all providers fail. */
  landCoverAllowMaskFallback: parseBoolean(process.env.LAND_COVER_ALLOW_MASK_FALLBACK, false),

  /** ESA WorldCover COG tile server. */
  worldCoverBaseUrl:
    process.env.WORLD_COVER_BASE_URL ||
    'https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map',
  worldCoverTimeoutMs: parseInteger(process.env.WORLD_COVER_TIMEOUT_MS, 20000),
  worldCoverConcurrency: parseInteger(process.env.WORLD_COVER_CONCURRENCY, 4),
  worldCoverRetries: parseInteger(process.env.WORLD_COVER_RETRIES, 2),

  /** OpenStreetMap Overpass fallback provider. */
  osmOverpassUrl: process.env.OSM_OVERPASS_URL || 'https://overpass-api.de/api/interpreter',
  osmOverpassTimeoutMs: parseInteger(process.env.OSM_OVERPASS_TIMEOUT_MS, 15000),
};

export default env;

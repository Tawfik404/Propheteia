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

  /** Background jobs */
  jobsEnabled: parseBoolean(process.env.JOBS_ENABLED, true),

  /** FWI system */
  fwiStartup: {
    ffmc: parseInteger(process.env.FWI_START_FFMC, 85),
    dmc: parseInteger(process.env.FWI_START_DMC, 6),
    dc: parseInteger(process.env.FWI_START_DC, 15),
  },
};

export default env;

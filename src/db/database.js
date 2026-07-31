import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import env from '../config/env.js';
import logger from '../utils/logger.js';

let db = null;

/** SQL schema. Migrations are idempotent (CREATE TABLE IF NOT EXISTS). */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS fwi_state (
  location_key  TEXT NOT NULL,
  date          TEXT NOT NULL,
  ffmc          REAL NOT NULL,
  dmc           REAL NOT NULL,
  dc            REAL NOT NULL,
  isi           REAL NOT NULL,
  bui           REAL NOT NULL,
  fwi           REAL NOT NULL,
  dsr           REAL NOT NULL,
  temperature   REAL NOT NULL,
  humidity      REAL NOT NULL,
  wind_speed    REAL NOT NULL,
  rainfall_24h  REAL NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (location_key, date)
);

CREATE INDEX IF NOT EXISTS idx_fwi_state_location_date
  ON fwi_state (location_key, date DESC);

CREATE TABLE IF NOT EXISTS weather_cache (
  location_key TEXT PRIMARY KEY,
  payload      TEXT NOT NULL,
  expires_at   INTEGER NOT NULL,
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS monitored_locations (
  location_key TEXT PRIMARY KEY,
  lat          REAL NOT NULL,
  lon          REAL NOT NULL,
  name         TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

/**
 * Initialise the SQLite database (singleton).
 *
 * The FWI System is recursive: today's FFMC/DMC/DC depend on the previous
 * day's values. SQLite persists those values per monitored location so
 * calculations remain correct across server restarts.
 *
 * @returns {import('better-sqlite3').Database}
 */
export function getDatabase() {
  if (db) return db;

  const dbPath = path.resolve(process.cwd(), env.dbPath);
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('busy_timeout = 5000');
  db.exec(SCHEMA);

  logger.info(`[db] sqlite database ready at ${dbPath}`);
  return db;
}

/**
 * Close the database connection. Safe to call multiple times.
 */
export function closeDatabase() {
  if (db) {
    try {
      db.close();
    } catch (err) {
      logger.warn(`[db] error while closing database: ${err.message}`);
    }
    db = null;
  }
}

export default getDatabase;

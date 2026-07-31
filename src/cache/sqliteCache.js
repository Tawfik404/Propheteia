/**
 * SQLite-backed cache with TTL support.
 *
 * Provides persistence across server restarts for cached weather payloads.
 * Used when CACHE_BACKEND is 'sqlite' or 'both'. The backing table is
 * created by the database module (`weather_cache`).
 */
export class SqliteCache {
  /**
   * @param {object} db - better-sqlite3 Database instance
   * @param {object} [options]
   * @param {number} [options.ttlSeconds=600] - default entry lifetime
   */
  constructor(db, { ttlSeconds = 600 } = {}) {
    this.db = db;
    this.ttlSeconds = ttlSeconds;
    this.hits = 0;
    this.misses = 0;
  }

  set(key, value, ttlSeconds = this.ttlSeconds) {
    const expiresAt = Date.now() + ttlSeconds * 1000;
    this.db
      .prepare(
        `INSERT INTO weather_cache (location_key, payload, expires_at, updated_at)
         VALUES (?, ?, ?, datetime('now'))
         ON CONFLICT(location_key) DO UPDATE SET
           payload = excluded.payload,
           expires_at = excluded.expires_at,
           updated_at = datetime('now')`
      )
      .run(key, JSON.stringify(value), expiresAt);
  }

  get(key) {
    const row = this.db
      .prepare('SELECT payload, expires_at FROM weather_cache WHERE location_key = ?')
      .get(key);
    if (!row) {
      this.misses += 1;
      return undefined;
    }
    if (row.expires_at <= Date.now()) {
      this.delete(key);
      this.misses += 1;
      return undefined;
    }
    this.hits += 1;
    try {
      return JSON.parse(row.payload);
    } catch {
      this.delete(key);
      this.misses += 1;
      return undefined;
    }
  }

  async getOrSet(key, factory, ttlSeconds = this.ttlSeconds) {
    const cached = this.get(key);
    if (cached !== undefined) return cached;
    const value = await factory();
    this.set(key, value, ttlSeconds);
    return value;
  }

  delete(key) {
    this.db.prepare('DELETE FROM weather_cache WHERE location_key = ?').run(key);
  }

  /** Remove every entry whose TTL has elapsed. */
  purgeExpired() {
    return this.db
      .prepare('DELETE FROM weather_cache WHERE expires_at <= ?')
      .run(Date.now()).changes;
  }

  get size() {
    return this.db.prepare('SELECT COUNT(*) AS n FROM weather_cache').get().n;
  }

  get stats() {
    const total = this.hits + this.misses;
    return {
      size: this.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: total === 0 ? 0 : Number((this.hits / total).toFixed(3)),
    };
  }
}

export default SqliteCache;

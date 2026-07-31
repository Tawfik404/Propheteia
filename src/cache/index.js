import env from '../config/env.js';
import logger from '../utils/logger.js';
import MemoryCache from './memoryCache.js';
import { getDatabase } from '../db/database.js';
import SqliteCache from './sqliteCache.js';

/**
 * Cache store factory.
 *
 * Selects the caching backend(s) from CACHE_BACKEND:
 *  - 'memory': in-memory TTL cache (default, fastest)
 *  - 'sqlite': persistent TTL cache backed by SQLite
 *  - 'both'  : memory first, SQLite as the fallback tier
 *
 * The returned store exposes a single `getOrSet(key, factory, ttl?)`
 * contract so the rest of the application does not care about the backend.
 */
function buildStore() {
  const ttlSeconds = env.cacheTtlSeconds;
  const memory = new MemoryCache({ ttlSeconds });
  let sqlite = null;

  if (env.cacheBackend === 'sqlite' || env.cacheBackend === 'both') {
    try {
      sqlite = new SqliteCache(getDatabase(), { ttlSeconds });
    } catch (err) {
      logger.warn(`[cache] sqlite backend unavailable, falling back to memory: ${err.message}`);
    }
  }

  const store = {
    get(key) {
      if (sqlite) {
        const mem = memory.get(key);
        if (mem !== undefined) return mem;
        const persistent = sqlite.get(key);
        if (persistent !== undefined) {
          memory.set(key, persistent, ttlSeconds);
          return persistent;
        }
        return undefined;
      }
      return memory.get(key);
    },

    set(key, value, ttl = ttlSeconds) {
      memory.set(key, value, ttl);
      sqlite?.set(key, value, ttl);
    },

    async getOrSet(key, factory, ttl = ttlSeconds) {
      const cached = this.get(key);
      if (cached !== undefined) return cached;
      const value = await factory();
      this.set(key, value, ttl);
      return value;
    },

    async delete(key) {
      memory.delete(key);
      sqlite?.delete(key);
    },

    async purgeExpired() {
      const removed = sqlite?.purgeExpired() ?? 0;
      memory.sweep();
      return removed;
    },

    stats() {
      const memStats = memory.stats;
      return sqlite ? { memory: memStats, sqlite: sqlite.stats } : memStats;
    },

    backend: sqlite ? env.cacheBackend : 'memory',
  };

  return store;
}

/** Singleton cache store for the application. */
export const cacheStore = buildStore();

export default cacheStore;

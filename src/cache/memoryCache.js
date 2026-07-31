/**
 * In-memory TTL cache.
 *
 * Entries expire lazily (on read) and are also swept by a periodic interval
 * so expired entries do not accumulate. Suitable for caching weather
 * responses per location; keys are location keys produced by
 * `utils/geo#locationKey`.
 */
export class MemoryCache {
  /**
   * @param {object} [options]
   * @param {number} [options.ttlSeconds=600] - default entry lifetime
   * @param {number} [options.sweepIntervalMs=60000] - garbage collection interval
   */
  constructor({ ttlSeconds = 600, sweepIntervalMs = 60000 } = {}) {
    this.ttlSeconds = ttlSeconds;
    this.store = new Map(); // key -> { value, expiresAt }
    this.hits = 0;
    this.misses = 0;

    this.sweepTimer = setInterval(() => this.sweep(), sweepIntervalMs);
    this.sweepTimer.unref?.();
  }

  /**
   * @param {string} key
   * @param {*} value - any serializable value
   * @param {number} [ttlSeconds] - overrides the default TTL
   */
  set(key, value, ttlSeconds = this.ttlSeconds) {
    this.store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  }

  /**
   * @param {string} key
   * @returns {*} the cached value or undefined when missing/expired
   */
  get(key) {
    const entry = this.store.get(key);
    if (!entry) {
      this.misses += 1;
      return undefined;
    }
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      this.misses += 1;
      return undefined;
    }
    this.hits += 1;
    return entry.value;
  }

  /**
   * @param {string} key
   * @returns {*} cached value, or `factory()` result stored under the key
   */
  async getOrSet(key, factory, ttlSeconds = this.ttlSeconds) {
    const cached = this.get(key);
    if (cached !== undefined) return cached;
    const value = await factory();
    this.set(key, value, ttlSeconds);
    return value;
  }

  has(key) {
    return this.get(key) !== undefined;
  }

  delete(key) {
    return this.store.delete(key);
  }

  clear() {
    this.store.clear();
  }

  /** Remove every expired entry. */
  sweep() {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (entry.expiresAt <= now) this.store.delete(key);
    }
  }

  get size() {
    return this.store.size;
  }

  get stats() {
    const total = this.hits + this.misses;
    return {
      size: this.store.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: total === 0 ? 0 : Number((this.hits / total).toFixed(3)),
    };
  }

  close() {
    clearInterval(this.sweepTimer);
  }
}

export default MemoryCache;

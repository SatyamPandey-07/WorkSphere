export interface Cache<T> {
  get(key: string): T | undefined;
  set(key: string, value: T): void;
  invalidate(key: string): void;
  clear(): void;
}

interface CacheItem<T> {
  value: T;
  expiresAt: number;
}

export class LRUCache<T> implements Cache<T> {
  private capacity: number;
  private ttlMs: number;
  private cache: Map<string, CacheItem<T>>;

  /**
   * @param capacity Maximum number of items the cache can hold
   * @param ttlMs Time to live for each item in milliseconds
   */
  constructor(capacity: number, ttlMs: number) {
    if (capacity <= 0) {
      throw new Error("Capacity must be greater than 0");
    }
    this.capacity = capacity;
    this.ttlMs = ttlMs;
    this.cache = new Map();
  }

  get(key: string): T | undefined {
    const item = this.cache.get(key);
    if (!item) {
      return undefined;
    }

    if (Date.now() > item.expiresAt) {
      // Item expired
      this.cache.delete(key);
      return undefined;
    }

    // Refresh the position to mark as recently used
    this.cache.delete(key);
    this.cache.set(key, item);

    return item.value;
  }

  set(key: string, value: T): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.capacity) {
      // Evict the least recently used item (the first key in the Map)
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }

    this.cache.set(key, {
      value,
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  invalidate(key: string): void {
    this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }
}

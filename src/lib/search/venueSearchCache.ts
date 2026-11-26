const STORAGE_KEY = "worksphere:venue-search-cache:v1";

export const VENUE_SEARCH_CACHE_TTL = 10 * 60 * 1000;
export const MAX_VENUE_SEARCH_CACHE_ENTRIES = 50;

interface CacheEntry<T> {
  timestamp: number;
  data: T[];
}

type CacheStore = Record<string, CacheEntry<unknown>>;

function getStorage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function readStore(now: number): CacheStore {
  const storage = getStorage();
  if (!storage) return {};

  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return {};

    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      storage.removeItem(STORAGE_KEY);
      return {};
    }

    const store: CacheStore = {};

    for (const [key, value] of Object.entries(parsed)) {
      if (
        !value ||
        typeof value !== "object" ||
        !("timestamp" in value) ||
        !("data" in value)
      ) {
        continue;
      }

      const entry = value as CacheEntry<unknown>;

      if (
        typeof entry.timestamp !== "number" ||
        !Number.isFinite(entry.timestamp) ||
        !Array.isArray(entry.data)
      ) {
        continue;
      }

      if (now - entry.timestamp > VENUE_SEARCH_CACHE_TTL) {
        continue;
      }

      store[key] = entry;
    }

    return store;
  } catch {
    try {
      storage.removeItem(STORAGE_KEY);
    } catch {
      // Storage may be unavailable.
    }
    return {};
  }
}

function writeStore(store: CacheStore): void {
  const storage = getStorage();
  if (!storage) return;

  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Search must continue to work if storage is full or unavailable.
  }
}

export function getVenueSearchCache<T>(key: string): T[] | null {
  const store = readStore(Date.now());
  const entry = store[key];

  if (!entry) {
    writeStore(store);
    return null;
  }

  // Move the accessed entry to the end to maintain LRU ordering.
  delete store[key];
  store[key] = entry;

  writeStore(store);
  return entry.data as T[];
}

export function setVenueSearchCache<T>(key: string, data: T[]): void {
  const store = readStore(Date.now());

  // Reinsert to mark this query as most recently used.
  delete store[key];

  store[key] = {
    timestamp: Date.now(),
    data,
  };

  // Evict least recently used queries.
  while (Object.keys(store).length > MAX_VENUE_SEARCH_CACHE_ENTRIES) {
    const oldestKey = Object.keys(store)[0];
    delete store[oldestKey];
  }

  writeStore(store);
}

export function clearVenueSearchCache(): void {
  const storage = getStorage();
  if (!storage) return;

  try {
    storage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore unavailable storage.
  }
}

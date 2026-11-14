interface CacheItem<T> {
  data: T;
  expiresAt: number;
  delta: number; // Time taken to compute in seconds
  computedAt: number;
}

// In-memory cache store and in-flight request lock map
const cacheStore = new Map<string, CacheItem<any>>();
const inFlightPromises = new Map<string, Promise<any>>();

/**
 * XFetch probabilistic early expiration check.
 * -beta * delta * ln(random()) > (expiresAt - now)
 */
function computeIsExpired(expiresAt: number, delta: number, beta: number = 1.0): boolean {
  const now = Date.now();
  const ttl = (expiresAt - now) / 1000; // Remaining TTL in seconds

  if (ttl <= 0) return true;

  const randomValue = Math.random();
  // Avoid Math.log(0)
  const safeRandom = randomValue === 0 ? 0.0001 : randomValue;

  const probCheck = -beta * delta * Math.log(safeRandom);
  return probCheck > ttl;
}

export async function getOrSetVenueAvailability<T>(
  key: string,
  fetchFn: () => Promise<T>,
  ttlSeconds: number = 300
): Promise<T> {
  const now = Date.now();
  const cached = cacheStore.get(key);

  // 1. Check if cache exists and is valid (not probabilistically expired)
  if (cached) {
    const isExpired = computeIsExpired(cached.expiresAt, cached.delta);
    if (!isExpired) {
      return cached.data;
    }

    // Stale-While-Revalidate: If expired via XFetch, trigger background regeneration if not already in flight
    if (!inFlightPromises.has(key)) {
      backgroundRegenerate(key, fetchFn, ttlSeconds);
    }

    // Return stale data immediately for lightning-fast response during background regen
    return cached.data;
  }

  // 2. Single-flight promise deduplication for complete cache misses
  return executeSingleFlight(key, fetchFn, ttlSeconds);
}

async function executeSingleFlight<T>(
  key: string,
  fetchFn: () => Promise<T>,
  ttlSeconds: number
): Promise<T> {
  if (inFlightPromises.has(key)) {
    return inFlightPromises.get(key)!;
  }

  const startTime = performance.now();
  const promise = (async () => {
    try {
      const data = await fetchFn();
      const endTime = performance.now();
      const delta = (endTime - startTime) / 1000; // computation time in seconds

      const now = Date.now();
      cacheStore.set(key, {
        data,
        expiresAt: now + ttlSeconds * 1000,
        delta,
        computedAt: now,
      });

      return data;
    } finally {
      inFlightPromises.delete(key);
    }
  })();

  inFlightPromises.set(key, promise);
  return promise;
}

function backgroundRegenerate<T>(key: string, fetchFn: () => Promise<T>, ttlSeconds: number) {
  executeSingleFlight(key, fetchFn, ttlSeconds).catch((err) => {
    console.error(`Background cache regeneration failed for key [${key}]:`, err);
  });
}
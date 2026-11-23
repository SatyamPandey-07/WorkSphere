import { isAbortError } from '@/lib/search/semanticSearchClient';

export const DEFAULT_XFETCH_BETA = 1.0;
export const DEFAULT_BASELINE_DELTA_MS = 250;
export const DEFAULT_EMBEDDING_TTL_MS = 5 * 60 * 1000; // 5 minutes

export interface XFetchCacheEntry<T> {
  value: T;
  /** Time taken (ms) to compute the embedding; seeded with DEFAULT_BASELINE_DELTA_MS when cold */
  deltaMs: number;
  /** Absolute epoch timestamp (ms) when the cached entry hard-expires */
  expiryMs: number;
  createdAtMs: number;
}

export interface XFetchEvaluationOptions {
  nowMs?: number;
  beta?: number;
  baselineDeltaMs?: number;
  randomFn?: () => number;
}

export interface HybridEmbeddingSearchOptions {
  ttlMs?: number;
  beta?: number;
  baselineDeltaMs?: number;
  signal?: AbortSignal;
  nowFn?: () => number;
  randomFn?: () => number;
}

/**
 * Normalizes query text so minor casing/whitespace differences share the same cache bucket
 * ("Quiet Cafe Near Me " -> "quiet cafe near me").
 */
export function normalizeSemanticQueryKey(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Evaluates the XFetch probabilistic early-expiration formula:
 *   now - (effectiveDelta * beta * ln(rand)) >= expiry
 *
 * Ensures `effectiveDelta` is never 0 on cold/uninitialized entries by falling back
 * to `baselineDeltaMs` (default 250ms), guaranteeing probabilistic early refresh
 * prior to hard expiration.
 */
export function shouldTriggerXFetchEarlyRefresh(
  entry: Pick<XFetchCacheEntry<unknown>, 'deltaMs' | 'expiryMs'>,
  options: XFetchEvaluationOptions = {}
): boolean {
  const {
    nowMs = Date.now(),
    beta = DEFAULT_XFETCH_BETA,
    baselineDeltaMs = DEFAULT_BASELINE_DELTA_MS,
    randomFn = Math.random,
  } = options;

  // Hard expiration check
  if (nowMs >= entry.expiryMs) {
    return true;
  }

  // Seed cold/zero delta entries with a positive baseline latency estimate
  const effectiveDeltaMs =
    Number.isFinite(entry.deltaMs) && entry.deltaMs > 0
      ? entry.deltaMs
      : Math.max(1, baselineDeltaMs);

  // Clamp random draw away from 0 to avoid -Infinity from Math.log(0)
  const u = Math.min(1 - Number.EPSILON, Math.max(Number.EPSILON, randomFn()));
  const earlyWindowMs = -effectiveDeltaMs * beta * Math.log(u);

  return nowMs + earlyWindowMs >= entry.expiryMs;
}

/**
 * Stampede-resistant XFetch vector embedding cache with single-flight coalescing
 * and cold-entry baseline delta seeding.
 */
export class XFetchVectorCache<T = number[]> {
  private readonly store = new Map<string, XFetchCacheEntry<T>>();
  private readonly inFlight = new Map<string, Promise<XFetchCacheEntry<T>>>();

  private readonly defaultTtlMs: number;
  private readonly defaultBeta: number;
  private readonly baselineDeltaMs: number;
  private readonly nowFn: () => number;
  private readonly randomFn: () => number;

  constructor(options: {
    ttlMs?: number;
    beta?: number;
    baselineDeltaMs?: number;
    nowFn?: () => number;
    randomFn?: () => number;
  } = {}) {
    this.defaultTtlMs = options.ttlMs ?? DEFAULT_EMBEDDING_TTL_MS;
    this.defaultBeta = options.beta ?? DEFAULT_XFETCH_BETA;
    this.baselineDeltaMs = options.baselineDeltaMs ?? DEFAULT_BASELINE_DELTA_MS;
    this.nowFn = options.nowFn ?? Date.now;
    this.randomFn = options.randomFn ?? Math.random;
  }

  public getEntry(rawKey: string): XFetchCacheEntry<T> | undefined {
    return this.store.get(normalizeSemanticQueryKey(rawKey));
  }

  /**
   * Seeds or updates a cache entry directly, ensuring `deltaMs` is always initialized
   * to at least `baselineDeltaMs` when caller supplies 0 or omits compute duration.
   */
  public setEntry(
    rawKey: string,
    value: T,
    options: { ttlMs?: number; deltaMs?: number } = {}
  ): XFetchCacheEntry<T> {
    const key = normalizeSemanticQueryKey(rawKey);
    const nowMs = this.nowFn();
    const ttlMs = options.ttlMs ?? this.defaultTtlMs;

    const seededDeltaMs =
      typeof options.deltaMs === 'number' &&
        Number.isFinite(options.deltaMs) &&
        options.deltaMs > 0
        ? options.deltaMs
        : this.baselineDeltaMs;

    const entry: XFetchCacheEntry<T> = {
      value,
      deltaMs: seededDeltaMs,
      expiryMs: nowMs + ttlMs,
      createdAtMs: nowMs,
    };

    this.store.set(key, entry);
    return entry;
  }

  /**
   * Retrieves a cached embedding using XFetch early expiration and single-flight coalescing:
   * - Cold miss: coalesces all concurrent callers into a single upstream compute call.
   * - Warm hit within XFetch early window: triggers a single non-blocking background refresh
   *   while immediately returning the still-valid cached embedding to callers.
   * - Hard expired entry: coalesces refresh so only one upstream call executes.
   */
  public async getOrCompute(
    rawKey: string,
    computeFn: (signal?: AbortSignal) => Promise<T>,
    options: HybridEmbeddingSearchOptions = {}
  ): Promise<{ value: T; cacheStatus: 'HIT' | 'EARLY_REFRESH' | 'MISS' }> {
    const key = normalizeSemanticQueryKey(rawKey);
    const nowFn = options.nowFn ?? this.nowFn;
    const randomFn = options.randomFn ?? this.randomFn;
    const beta = options.beta ?? this.defaultBeta;
    const ttlMs = options.ttlMs ?? this.defaultTtlMs;
    const baselineDeltaMs = options.baselineDeltaMs ?? this.baselineDeltaMs;

    const nowMs = nowFn();
    const cached = this.store.get(key);

    if (cached && nowMs < cached.expiryMs) {
      const needsEarlyRefresh = shouldTriggerXFetchEarlyRefresh(cached, {
        nowMs,
        beta,
        baselineDeltaMs,
        randomFn,
      });

      if (needsEarlyRefresh && !this.inFlight.has(key)) {
        // Launch single-flight background recomputation without blocking the current reader
        void this.coalescedRecompute(key, computeFn, {
          ttlMs,
          baselineDeltaMs,
          nowFn,
        }).catch((err) => {
          if (!isAbortError(err)) {
            console.warn(`[XFetchVectorCache] Background refresh failed for "${key}":`, err);
          }
        });

        return { value: cached.value, cacheStatus: 'EARLY_REFRESH' };
      }

      return { value: cached.value, cacheStatus: 'HIT' };
    }

    // Hard miss or hard-expired entry -> coalesce concurrent requests into one upstream call
    const entry = await this.coalescedRecompute(key, computeFn, {
      ttlMs,
      baselineDeltaMs,
      nowFn,
      signal: options.signal,
    });

    return { value: entry.value, cacheStatus: 'MISS' };
  }

  private async coalescedRecompute(
    normalizedKey: string,
    computeFn: (signal?: AbortSignal) => Promise<T>,
    opts: {
      ttlMs: number;
      baselineDeltaMs: number;
      nowFn: () => number;
      signal?: AbortSignal;
    }
  ): Promise<XFetchCacheEntry<T>> {
    const existingFlight = this.inFlight.get(normalizedKey);
    if (existingFlight) {
      return existingFlight;
    }

    const flightPromise = (async () => {
      const startedAt = opts.nowFn();
      const value = await computeFn(opts.signal);
      const finishedAt = opts.nowFn();

      const measuredDeltaMs = Math.max(
        opts.baselineDeltaMs,
        finishedAt - startedAt
      );

      const entry: XFetchCacheEntry<T> = {
        value,
        deltaMs: measuredDeltaMs,
        expiryMs: finishedAt + opts.ttlMs,
        createdAtMs: finishedAt,
      };

      this.store.set(normalizedKey, entry);
      return entry;
    })();

    this.inFlight.set(normalizedKey, flightPromise);

    try {
      return await flightPromise;
    } finally {
      if (this.inFlight.get(normalizedKey) === flightPromise) {
        this.inFlight.delete(normalizedKey);
      }
    }
  }

  public clear(): void {
    this.store.clear();
    this.inFlight.clear();
  }
}

// Shared singleton vector cache across hybrid semantic venue search invocations
const globalForVectorCache = globalThis as unknown as {
  __worksphereXFetchVectorCache?: XFetchVectorCache<number[]>;
};

export const sharedEmbeddingVectorCache =
  globalForVectorCache.__worksphereXFetchVectorCache ??
  new XFetchVectorCache<number[]>();

if (!globalForVectorCache.__worksphereXFetchVectorCache) {
  globalForVectorCache.__worksphereXFetchVectorCache = sharedEmbeddingVectorCache;
}
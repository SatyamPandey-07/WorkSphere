/**
 * Helpers mirroring the Service Worker image-cache quota (20MB LRU).
 * Unit-tested here; enforced in public/sw.js via IndexedDB LRU + Cache Storage.
 */

export const MAX_CACHE_BYTES = 20 * 1024 * 1024; // 20MB — under iOS Safari ~50MB PWA quota

export async function estimateResponseSize(
  response: Response,
): Promise<number> {
  const header = response.headers.get("content-length");
  if (header) {
    const n = Number(header);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  try {
    const buf = await response.clone().arrayBuffer();
    return buf.byteLength;
  } catch {
    return 0;
  }
}

type CacheLike = {
  keys: () => Promise<Request[]>;
  match: (request: Request) => Promise<Response | undefined>;
  delete: (request: Request) => Promise<boolean>;
  put: (request: Request, response: Response) => Promise<void>;
};

/** Drop oldest entries until total estimated size fits under maxBytes. */
export async function trimCacheToMaxBytes(
  cache: CacheLike,
  maxBytes: number = MAX_CACHE_BYTES,
): Promise<void> {
  const keys = await cache.keys();
  const entries: { request: Request; size: number }[] = [];
  let total = 0;

  for (const request of keys) {
    const response = await cache.match(request);
    if (!response) continue;
    const size = await estimateResponseSize(response);
    entries.push({ request, size });
    total += size;
  }

  // Cache#keys is insertion-ordered in major browsers; oldest first.
  let i = 0;
  while (total > maxBytes && i < entries.length) {
    const entry = entries[i++];
    await cache.delete(entry.request);
    total -= entry.size;
  }
}

export async function cachePutWithLruLimit(
  cache: CacheLike,
  request: Request,
  response: Response,
  maxBytes: number = MAX_CACHE_BYTES,
): Promise<void> {
  await cache.put(request, response);
  await trimCacheToMaxBytes(cache, maxBytes);
}

/**
 * Checks navigator.storage.estimate() to determine if sufficient storage quota is available
 * before performing CacheStorage writes (e.g. pre-fetching venue video tours or large media).
 * Prevents QuotaExceededError crashes on mobile browsers (e.g. Android Chrome).
 *
 * iOS Safari in Private Browsing / Strict Privacy mode may reject the estimate() promise or
 * return unrealistic quota values (e.g. Number.MAX_SAFE_INTEGER). Both cases are handled
 * gracefully by returning `true` (assume sufficient) when the estimate is unavailable.
 */
export async function hasSufficientStorageQuota(
  requiredBytes: number = 0,
): Promise<boolean> {
  if (
    typeof navigator !== "undefined" &&
    navigator.storage &&
    typeof navigator.storage.estimate === "function"
  ) {
    try {
      const estimate = await navigator.storage.estimate();
      const quota = estimate.quota;
      const usage = estimate.usage;

      if (
        quota !== undefined &&
        usage !== undefined &&
        Number.isFinite(quota) &&
        Number.isFinite(usage) &&
        quota > 0
      ) {
        const availableBytes = quota - usage;
        // Guard against negative/NaN results from corrupt estimates
        if (!Number.isFinite(availableBytes) || availableBytes < 0) {
          return true;
        }
        const minRequiredBuffer = Math.max(requiredBytes, 5 * 1024 * 1024);
        return availableBytes >= minRequiredBuffer;
      }
    } catch (err) {
      // iOS Safari Private Browsing and Strict Privacy modes reject the promise.
      // Fall through to the default `true` so offline caching is not blocked.
      console.warn("[SW] Failed to estimate storage quota (may be iOS Private Browsing):", err);
    }
  }
  return true;
}

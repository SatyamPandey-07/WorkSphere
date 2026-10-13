/**
 * Offline Storage & Quota Estimation with Cached Floor Plan Byte Tracking
 *
 * Utilises `navigator.storage.estimate()` to inspect device quota limits,
 * calculates exact bytes consumed by offline cached floor plans in IndexedDB
 * and Cache Storage, and computes proportional quota usage metrics.
 */

import { initOfflineDB } from "./db";

export interface OfflineStorageStats {
  /** Total bytes currently consumed across all origins/stores */
  usageBytes: number;
  /** Total storage quota granted by browser in bytes */
  quotaBytes: number;
  /** Overall quota usage percentage (0-100) */
  usagePercent: number;
  /** Total bytes specifically consumed by cached floor plans */
  floorPlanBytes: number;
  /** Total number of unique floor plans stored offline */
  floorPlanCount: number;
  /** Floor plan bytes as a percentage of total consumed storage (0-100) */
  floorPlanPercentOfUsage: number;
  /** Floor plan bytes as a percentage of total storage quota (0-100) */
  floorPlanPercentOfQuota: number;
  /** True if navigator.storage.estimate() is supported and succeeded */
  isEstimateAvailable: boolean;
}

export const DEFAULT_OFFLINE_STORAGE_STATS: OfflineStorageStats = {
  usageBytes: 0,
  quotaBytes: 0,
  usagePercent: 0,
  floorPlanBytes: 0,
  floorPlanCount: 0,
  floorPlanPercentOfUsage: 0,
  floorPlanPercentOfQuota: 0,
  isEstimateAvailable: false,
};

export const STORAGE_STATS_CACHE_KEY = "worksphere_offline_storage_stats";
export const STALE_FLOOR_PLAN_AGE_MS = 30 * 24 * 60 * 60 * 1000;

const FLOOR_PLAN_STORES = ["venues", "favorites", "recentlyViewedVenues"] as const;

interface CachedFloorPlanRecord {
  id?: string;
  floorplan?: unknown;
  lastAccessedAt?: number;
}

export interface StaleFloorPlanCacheStats {
  count: number;
  reclaimableBytes: number;
}

/**
 * Safely parses and validates a raw string or payload into OfflineStorageStats.
 * Resilient against malformed/corrupted JSON payloads or interrupted browser writes,
 * gracefully catching SyntaxErrors, logging a diagnostic warning, and resetting to defaults.
 */
export function parseOfflineStorageStats(raw: unknown): OfflineStorageStats {
  if (raw === null || raw === undefined || raw === "") {
    return { ...DEFAULT_OFFLINE_STORAGE_STATS };
  }

  let parsed: unknown;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      console.warn(
        "[StorageStats] Corrupted or malformed storage stats JSON detected; resetting to defaults:",
        err instanceof Error ? err.message : err,
      );
      return { ...DEFAULT_OFFLINE_STORAGE_STATS };
    }
  } else {
    parsed = raw;
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    console.warn(
      "[StorageStats] Invalid storage stats payload format (expected object); resetting to defaults",
    );
    return { ...DEFAULT_OFFLINE_STORAGE_STATS };
  }

  const data = parsed as Record<string, unknown>;
  const usageBytes =
    typeof data.usageBytes === "number" && !isNaN(data.usageBytes) && isFinite(data.usageBytes)
      ? Math.max(0, data.usageBytes)
      : 0;
  const quotaBytes =
    typeof data.quotaBytes === "number" && !isNaN(data.quotaBytes) && isFinite(data.quotaBytes)
      ? Math.max(0, data.quotaBytes)
      : 0;
  const floorPlanBytes =
    typeof data.floorPlanBytes === "number" && !isNaN(data.floorPlanBytes) && isFinite(data.floorPlanBytes)
      ? Math.max(0, data.floorPlanBytes)
      : 0;
  const floorPlanCount =
    typeof data.floorPlanCount === "number" && !isNaN(data.floorPlanCount) && isFinite(data.floorPlanCount)
      ? Math.max(0, Math.floor(data.floorPlanCount))
      : 0;

  const usagePercent =
    typeof data.usagePercent === "number" && !isNaN(data.usagePercent) && isFinite(data.usagePercent)
      ? Math.min(100, Math.max(0, data.usagePercent))
      : quotaBytes > 0
        ? Math.min(100, Math.max(0, (usageBytes / quotaBytes) * 100))
        : 0;

  const floorPlanPercentOfUsage =
    typeof data.floorPlanPercentOfUsage === "number" && !isNaN(data.floorPlanPercentOfUsage) && isFinite(data.floorPlanPercentOfUsage)
      ? Math.min(100, Math.max(0, data.floorPlanPercentOfUsage))
      : usageBytes > 0
        ? Math.min(100, Math.max(0, (floorPlanBytes / usageBytes) * 100))
        : 0;

  const floorPlanPercentOfQuota =
    typeof data.floorPlanPercentOfQuota === "number" && !isNaN(data.floorPlanPercentOfQuota) && isFinite(data.floorPlanPercentOfQuota)
      ? Math.min(100, Math.max(0, data.floorPlanPercentOfQuota))
      : quotaBytes > 0
        ? Math.min(100, Math.max(0, (floorPlanBytes / quotaBytes) * 100))
        : 0;

  const isEstimateAvailable =
    typeof data.isEstimateAvailable === "boolean" ? data.isEstimateAvailable : false;

  return {
    usageBytes,
    quotaBytes,
    usagePercent,
    floorPlanBytes,
    floorPlanCount,
    floorPlanPercentOfUsage,
    floorPlanPercentOfQuota,
    isEstimateAvailable,
  };
}

export const parseStorageStats = parseOfflineStorageStats;

/**
 * Hydrates offline storage stats from localStorage cache.
 * Catches SyntaxError or malformed JSON, resetting the corrupted cache to default metrics
 * and logging a diagnostic warning.
 */
export function hydrateOfflineStorageStats(
  storageKey = STORAGE_STATS_CACHE_KEY,
): OfflineStorageStats {
  if (typeof window === "undefined" || !window.localStorage) {
    return { ...DEFAULT_OFFLINE_STORAGE_STATS };
  }

  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return { ...DEFAULT_OFFLINE_STORAGE_STATS };
    }
    return parseOfflineStorageStats(raw);
  } catch (err) {
    console.warn(
      `[StorageStats] Failed hydrating storage stats from localStorage key '${storageKey}'; resetting to defaults:`,
      err instanceof Error ? err.message : err,
    );
    try {
      window.localStorage.removeItem(storageKey);
    } catch {
      // Ignore removal errors
    }
    return { ...DEFAULT_OFFLINE_STORAGE_STATS };
  }
}

export const hydrateStorageStats = hydrateOfflineStorageStats;

/**
 * Saves offline storage stats to localStorage cache.
 */
export function saveOfflineStorageStats(
  stats: OfflineStorageStats,
  storageKey = STORAGE_STATS_CACHE_KEY,
): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(stats));
  } catch (err) {
    console.warn("[StorageStats] Failed saving storage stats to localStorage:", err);
  }
}

/**
 * Formats a byte number into a human-readable string (B, KB, MB, GB).
 */
export function formatBytes(bytes: number, decimals = 1): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const idx = Math.min(Math.max(0, i), sizes.length - 1);
  return `${parseFloat((bytes / Math.pow(k, idx)).toFixed(dm))} ${sizes[idx]}`;
}

/**
 * Calculates byte size of a floor plan data object or SVG string.
 */
export function calculateFloorPlanByteSize(floorplan: unknown): number {
  if (floorplan === null || floorplan === undefined) return 0;

  if (typeof floorplan === "string") {
    try {
      return new TextEncoder().encode(floorplan).length;
    } catch {
      return floorplan.length * 2;
    }
  }

  try {
    const json = JSON.stringify(floorplan);
    return new TextEncoder().encode(json).length;
  } catch {
    return 0;
  }
}

/**
 * Finds cached floorplans that have not been accessed in the last 30 days.
 */
export async function getStaleFloorPlanCacheStats(
  now = Date.now(),
): Promise<StaleFloorPlanCacheStats> {
  const database = await initOfflineDB();
  const storeNames = FLOOR_PLAN_STORES.filter((name) =>
    database.objectStoreNames.contains(name),
  );
  if (storeNames.length === 0) return { count: 0, reclaimableBytes: 0 };

  const transaction = database.transaction([...storeNames], "readonly");
  const records = await Promise.all(
    storeNames.map(
      (storeName) =>
        new Promise<CachedFloorPlanRecord[]>((resolve, reject) => {
          const request = transaction.objectStore(storeName).getAll();
          request.onsuccess = () => resolve(request.result as CachedFloorPlanRecord[]);
          request.onerror = () => reject(request.error ?? new Error(`Failed reading ${storeName}`));
        }),
    ),
  );

  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("Failed reading cached floorplans"));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("Cached floorplan scan was aborted"));
  });

  const cutoff = now - STALE_FLOOR_PLAN_AGE_MS;
  let count = 0;
  let reclaimableBytes = 0;
  for (const storeRecords of records) {
    for (const record of storeRecords) {
      if (
        record?.floorplan != null &&
        typeof record.lastAccessedAt === "number" &&
        record.lastAccessedAt < cutoff
      ) {
        count++;
        reclaimableBytes += calculateFloorPlanByteSize(record.floorplan);
      }
    }
  }

  return { count, reclaimableBytes };
}

/**
 * Removes floorplan payloads from stale records while preserving cached venue metadata.
 * Access timestamps are checked again inside the write transaction to avoid removing a
 * floorplan that was accessed after the user reviewed the confirmation prompt.
 */
export async function purgeStaleFloorPlanCache(
  now = Date.now(),
): Promise<StaleFloorPlanCacheStats> {
  const database = await initOfflineDB();
  const storeNames = FLOOR_PLAN_STORES.filter((name) =>
    database.objectStoreNames.contains(name),
  );
  if (storeNames.length === 0) return { count: 0, reclaimableBytes: 0 };

  const cutoff = now - STALE_FLOOR_PLAN_AGE_MS;
  const transaction = database.transaction([...storeNames], "readwrite");
  let count = 0;
  let reclaimableBytes = 0;

  for (const storeName of storeNames) {
    const request = transaction.objectStore(storeName).openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;

      const record = cursor.value as CachedFloorPlanRecord;
      if (
        record?.floorplan != null &&
        typeof record.lastAccessedAt === "number" &&
        record.lastAccessedAt < cutoff
      ) {
        const { floorplan, ...metadata } = record;
        count++;
        reclaimableBytes += calculateFloorPlanByteSize(floorplan);
        cursor.update(metadata);
      }
      cursor.continue();
    };
  }

  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("Failed purging stale floorplans"));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("Stale floorplan cleanup was aborted"));
  });

  return { count, reclaimableBytes };
}

/**
 * Queries IndexedDB and navigator.storage.estimate() to retrieve
 * comprehensive storage quota usage and floor plan cache consumption.
 */
export async function getCachedFloorPlanStorageStats(): Promise<OfflineStorageStats> {
  let usageBytes = 0;
  let quotaBytes = 0;
  let isEstimateAvailable = false;

  // 1. Storage quota estimation via browser standard API
  if (
    typeof navigator !== "undefined" &&
    "storage" in navigator &&
    typeof navigator.storage?.estimate === "function"
  ) {
    try {
      const estimate = await navigator.storage.estimate();
      if (estimate.usage !== undefined) usageBytes = estimate.usage;
      if (estimate.quota !== undefined) quotaBytes = estimate.quota;
      isEstimateAvailable = true;
    } catch (e) {
      console.warn("[StorageStats] navigator.storage.estimate failed:", e);
    }
  }

  // 2. Measure bytes occupied by cached floor plans in IndexedDB
  let floorPlanBytes = 0;
  const floorPlanMap = new Map<string, unknown>();

  try {
    const database = await initOfflineDB();
    const storesToInspect = ["venues", "favorites", "recentlyViewedVenues"];

    for (const storeName of storesToInspect) {
      if (database.objectStoreNames.contains(storeName)) {
        try {
          const items = await new Promise<Array<{ id?: string; floorplan?: unknown }>>(
            (resolve, reject) => {
              const tx = database.transaction([storeName], "readonly");
              const store = tx.objectStore(storeName);
              const req = store.getAll();
              req.onsuccess = () => resolve((req.result as any[]) || []);
              req.onerror = () => reject(req.error);
            },
          );

          for (const item of items) {
            if (item && item.floorplan && item.id && !floorPlanMap.has(item.id)) {
              floorPlanMap.set(item.id, item.floorplan);
            }
          }
        } catch (storeErr) {
          console.warn(`[StorageStats] Failed inspecting store ${storeName}:`, storeErr);
        }
      }
    }

    for (const fp of floorPlanMap.values()) {
      floorPlanBytes += calculateFloorPlanByteSize(fp);
    }
  } catch (dbErr) {
    console.warn("[StorageStats] Failed accessing offline IndexedDB for floor plans:", dbErr);
  }

  // 3. Measure floor plan assets cached in CacheStorage if available
  if (typeof window !== "undefined" && "caches" in window) {
    try {
      const cacheKeys = await caches.keys();
      for (const cacheKey of cacheKeys) {
        if (cacheKey.toLowerCase().includes("floorplan") || cacheKey.toLowerCase().includes("venue")) {
          const cache = await caches.open(cacheKey);
          const requests = await cache.keys();
          for (const req of requests) {
            if (req.url.toLowerCase().includes("floorplan") || req.url.endsWith(".svg")) {
              const res = await cache.match(req);
              if (res) {
                const blob = await res.clone().blob();
                floorPlanBytes += blob.size;
              }
            }
          }
        }
      }
    } catch {
      // CacheStorage inspection is best-effort
    }
  }

  const floorPlanCount = floorPlanMap.size;
  const usagePercent =
    quotaBytes > 0 ? Math.min(100, Math.max(0, (usageBytes / quotaBytes) * 100)) : 0;
  const floorPlanPercentOfUsage =
    usageBytes > 0 ? Math.min(100, Math.max(0, (floorPlanBytes / usageBytes) * 100)) : 0;
  const floorPlanPercentOfQuota =
    quotaBytes > 0 ? Math.min(100, Math.max(0, (floorPlanBytes / quotaBytes) * 100)) : 0;

  const stats: OfflineStorageStats = {
    usageBytes,
    quotaBytes,
    usagePercent,
    floorPlanBytes,
    floorPlanCount,
    floorPlanPercentOfUsage,
    floorPlanPercentOfQuota,
    isEstimateAvailable,
  };

  saveOfflineStorageStats(stats);
  return stats;
}

export interface StorageCategoryBreakdown {
  name: string;
  bytes: number;
  percentage: number;
  formattedBytes: string;
  formattedPercent: string;
}

export interface StorageBreakdownResult {
  totalBytes: number;
  formattedTotal: string;
  categories: StorageCategoryBreakdown[];
}

/**
 * Formats a storage breakdown category cleanly as e.g. "0 B (0%)" or "1.5 MB (25%)".
 * Guards against zero denominator and NaN.
 */
export function formatStorageBreakdown(bytes: number, totalBytes: number): string {
  const formatted = formatBytes(bytes);
  if (!totalBytes || totalBytes <= 0 || !Number.isFinite(totalBytes) || !bytes || bytes <= 0) {
    return `${formatted} (0%)`;
  }
  const percent = Math.min(100, Math.max(0, Math.round((bytes / totalBytes) * 100)));
  return `${formatted} (${percent}%)`;
}

/**
 * Calculates storage breakdown metrics across categories.
 * When total storage used is 0, category percentages safely default to 0% rather than evaluating to NaN.
 */
export async function getStorageBreakdown(
  stats?: OfflineStorageStats,
): Promise<StorageBreakdownResult> {
  const currentStats = stats ?? (await getCachedFloorPlanStorageStats());
  const totalBytes = currentStats.usageBytes || currentStats.floorPlanBytes || 0;

  const floorPlanBytes = currentStats.floorPlanBytes || 0;
  const otherBytes = Math.max(0, (currentStats.usageBytes || 0) - floorPlanBytes);

  const calculatePercent = (bytes: number): number => {
    if (!totalBytes || totalBytes <= 0 || !Number.isFinite(totalBytes) || !bytes || bytes <= 0) {
      return 0;
    }
    const pct = (bytes / totalBytes) * 100;
    return Number.isFinite(pct) ? Math.min(100, Math.max(0, Math.round(pct * 10) / 10)) : 0;
  };

  const categories: StorageCategoryBreakdown[] = [
    {
      name: "Floor Plans",
      bytes: floorPlanBytes,
      percentage: calculatePercent(floorPlanBytes),
      formattedBytes: formatBytes(floorPlanBytes),
      formattedPercent: `${calculatePercent(floorPlanBytes)}%`,
    },
    {
      name: "Metadata & Cache",
      bytes: otherBytes,
      percentage: calculatePercent(otherBytes),
      formattedBytes: formatBytes(otherBytes),
      formattedPercent: `${calculatePercent(otherBytes)}%`,
    },
  ];

  return {
    totalBytes,
    formattedTotal: formatBytes(totalBytes),
    categories,
  };
}

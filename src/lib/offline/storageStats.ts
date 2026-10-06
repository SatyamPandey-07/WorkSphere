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

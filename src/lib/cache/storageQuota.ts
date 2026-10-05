/**
 * Storage quota management and event dispatch for IndexedDB caching (#3766).
 */

export const STORAGE_QUOTA_WARNING_EVENT = "worksphere:storage-quota-warning";

export interface StorageQuotaWarningDetail {
  source: string;
  errorName?: string;
  message?: string;
  timestamp: number;
}

/**
 * Checks whether an error represents a browser storage quota exhaustion.
 */
export function isQuotaExceededError(err: unknown): boolean {
  if (!err) return false;
  if (err instanceof DOMException) {
    return (
      err.name === "QuotaExceededError" ||
      err.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
      err.code === 22 // legacy QUOTA_EXCEEDED_ERR
    );
  }
  if (typeof err === "object" && err !== null && "name" in err) {
    const name = (err as { name?: unknown }).name;
    return (
      name === "QuotaExceededError" ||
      name === "NS_ERROR_DOM_QUOTA_REACHED"
    );
  }
  return false;
}

/**
 * Dispatches the custom window event `worksphere:storage-quota-warning`.
 */
export function dispatchStorageQuotaWarning(source: string, error?: unknown): void {
  if (typeof window === "undefined") return;

  const safeSource = typeof source === "string" && source.trim() ? source.trim() : "storage";
  const detail: StorageQuotaWarningDetail = {
    source: safeSource,
    errorName: (error as any)?.name ?? "QuotaExceededError",
    message: (error as any)?.message ?? "Storage quota exceeded",
    timestamp: Date.now(),
  };

  try {
    window.dispatchEvent(
      new CustomEvent(STORAGE_QUOTA_WARNING_EVENT, { detail })
    );
  } catch (err) {
    console.error("[StorageQuota] Failed to dispatch quota warning event:", err);
  }
}

/**
 * Clears stale ephemeral caches across the application to free up IndexedDB storage.
 */
export async function clearStaleCaches(): Promise<{ cleared: string[]; errors: string[] }> {
  const cleared: string[] = [];
  const errors: string[] = [];

  // 1. Purge zkp proof cache
  try {
    const { clearProofCache } = await import("@/lib/zkp/proofCache");
    await clearProofCache();
    cleared.push("proofCache");
  } catch (err) {
    errors.push(`proofCache: ${err}`);
  }

  // 2. Clear HNSW index cache
  try {
    const { clearHnswCache } = await import("@/lib/cache/hnswCache");
    await clearHnswCache();
    cleared.push("hnswCache");
  } catch (err) {
    errors.push(`hnswCache: ${err}`);
  }

  // 3. Purge federated model weights (default window keeps fresh weights)
  try {
    const { purgeStaleWeights } = await import("@/lib/federated/weightDb");
    await purgeStaleWeights();
    cleared.push("federatedWeights");
  } catch (err) {
    errors.push(`federatedWeights: ${err}`);
  }

  return { cleared, errors };
}

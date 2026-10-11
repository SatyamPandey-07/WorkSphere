"use client";

import { useState, useEffect, useCallback } from "react";
import {
  X,
  Database,
  RefreshCw,
  Trash2,
  CheckCircle2,
  AlertCircle,
  HardDrive,
} from "lucide-react";
import { initOfflineDB } from "@/lib/offline/db";

export interface SyncLogItem {
  id?: number | string;
  type?: string;
  action?: string;
  venueId?: string;
  timestamp?: number | string | null;
  retryCount?: number;
  status?: string;
  data?: Record<string, unknown>;
}

export const DEFAULT_MAX_CACHE_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days in ms

export interface PruneResult {
  deletedCount: number;
  recoveredBytes: number;
  recoveredMB: number;
}

export const OFFLINE_CACHE_STORES = [
  "venues",
  "recentlyViewedVenues",
  "searches",
  "notes_cache",
] as const;

/**
 * Scans offline IndexedDB stores and prunes cache entries older than maxAgeMs.
 * Returns the count of deleted items, total recovered bytes, and recovered megabytes.
 */
export async function pruneStaleEntries(
  maxAgeMs: number = DEFAULT_MAX_CACHE_AGE_MS,
): Promise<PruneResult> {
  if (typeof window === "undefined" || typeof indexedDB === "undefined") {
    return { deletedCount: 0, recoveredBytes: 0, recoveredMB: 0 };
  }

  let db: IDBDatabase;
  try {
    db = await initOfflineDB();
  } catch (err) {
    console.warn(
      "[OfflineStorageInspector] Failed opening IndexedDB for pruning:",
      err,
    );
    return { deletedCount: 0, recoveredBytes: 0, recoveredMB: 0 };
  }

  const existingStores = OFFLINE_CACHE_STORES.filter((store) =>
    db.objectStoreNames.contains(store),
  );

  if (existingStores.length === 0) {
    return { deletedCount: 0, recoveredBytes: 0, recoveredMB: 0 };
  }

  const cutoff = Date.now() - maxAgeMs;

  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(existingStores, "readwrite");
      let deletedCount = 0;
      let recoveredBytes = 0;

      for (const storeName of existingStores) {
        const store = tx.objectStore(storeName);
        const request = store.openCursor();

        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) return;

          const record = cursor.value as Record<string, unknown>;
          if (record) {
            // Do not delete pinned or explicitly favorited venues
            const isProtected =
              record.isPinned === true || record.isFavorite === true;

            const ts =
              record.lastAccessedAt ??
              record.savedAt ??
              record.viewedAt ??
              record.timestamp ??
              record.updatedAt ??
              record.createdAt;

            let numTs: number | null = null;
            if (typeof ts === "number" && !isNaN(ts)) {
              numTs = ts;
            } else if (typeof ts === "string") {
              const parsed = new Date(ts).getTime();
              if (!isNaN(parsed)) numTs = parsed;
            }

            if (!isProtected && numTs !== null && numTs < cutoff) {
              try {
                const encoded = new TextEncoder().encode(
                  JSON.stringify(record),
                );
                recoveredBytes += encoded.length;
              } catch {
                recoveredBytes += 512;
              }
              cursor.delete();
              deletedCount++;
            }
          }

          cursor.continue();
        };

        request.onerror = (e) => {
          console.warn(
            `[OfflineStorageInspector] Error cursor scanning ${storeName}:`,
            e,
          );
        };
      }

      tx.oncomplete = () => {
        const recoveredMB = Number((recoveredBytes / (1024 * 1024)).toFixed(2));
        resolve({ deletedCount, recoveredBytes, recoveredMB });
      };

      tx.onerror = () => {
        reject(tx.error || new Error("Pruning transaction failed"));
      };

      tx.onabort = () => {
        reject(tx.error || new Error("Pruning transaction was aborted"));
      };
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Scans offline IndexedDB stores and calculates the estimated reclaimable storage size.
 */
export async function estimateStaleEntries(
  maxAgeMs: number = DEFAULT_MAX_CACHE_AGE_MS,
): Promise<{ count: number; bytes: number; mb: number }> {
  if (typeof window === "undefined" || typeof indexedDB === "undefined") {
    return { count: 0, bytes: 0, mb: 0 };
  }

  let db: IDBDatabase;
  try {
    db = await initOfflineDB();
  } catch {
    return { count: 0, bytes: 0, mb: 0 };
  }

  const existingStores = OFFLINE_CACHE_STORES.filter((store) =>
    db.objectStoreNames.contains(store),
  );

  if (existingStores.length === 0) {
    return { count: 0, bytes: 0, mb: 0 };
  }

  const cutoff = Date.now() - maxAgeMs;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(existingStores, "readonly");
      let count = 0;
      let bytes = 0;

      for (const storeName of existingStores) {
        const store = tx.objectStore(storeName);
        const request = store.openCursor();

        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) return;

          const record = cursor.value as Record<string, unknown>;
          if (record) {
            const isProtected =
              record.isPinned === true || record.isFavorite === true;
            const ts =
              record.lastAccessedAt ??
              record.savedAt ??
              record.viewedAt ??
              record.timestamp ??
              record.updatedAt ??
              record.createdAt;

            let numTs: number | null = null;
            if (typeof ts === "number" && !isNaN(ts)) {
              numTs = ts;
            } else if (typeof ts === "string") {
              const parsed = new Date(ts).getTime();
              if (!isNaN(parsed)) numTs = parsed;
            }

            if (!isProtected && numTs !== null && numTs < cutoff) {
              try {
                const encoded = new TextEncoder().encode(
                  JSON.stringify(record),
                );
                bytes += encoded.length;
              } catch {
                bytes += 512;
              }
              count++;
            }
          }
          cursor.continue();
        };
      }

      tx.oncomplete = () => {
        const mb = Number((bytes / (1024 * 1024)).toFixed(2));
        resolve({ count, bytes, mb });
      };

      tx.onerror = () => {
        resolve({ count: 0, bytes: 0, mb: 0 });
      };
    } catch {
      resolve({ count: 0, bytes: 0, mb: 0 });
    }
  });
}

export function formatSyncTimestamp(
  timestamp: number | string | null | undefined,
): string {
  if (timestamp === null || timestamp === undefined || timestamp === "") {
    return "N/A";
  }

  if (typeof timestamp === "number" && isNaN(timestamp)) {
    return "N/A";
  }

  let numericTs: number;

  if (typeof timestamp === "string") {
    // Check if string is numeric epoch
    const parsedNumber = Number(timestamp);
    if (!isNaN(parsedNumber)) {
      numericTs = parsedNumber;
    } else {
      const parsedDate = new Date(timestamp);
      if (isNaN(parsedDate.getTime())) {
        return "Invalid Date";
      }
      return parsedDate.toLocaleString();
    }
  } else {
    numericTs = timestamp;
  }

  const date = new Date(numericTs);
  if (isNaN(date.getTime())) {
    return "Invalid Date";
  }

  return date.toLocaleString();
}

interface OfflineStorageInspectorProps {
  isOpen: boolean;
  onClose: () => void;
  logs?: SyncLogItem[];
  onClearLogs?: () => void;
  onRefresh?: () => void;
  onPrune?: (recoveredMB: number) => void;
  maxAgeMs?: number;
}

export function OfflineStorageInspector({
  isOpen,
  onClose,
  logs = [],
  onClearLogs,
  onRefresh,
  onPrune,
  maxAgeMs = DEFAULT_MAX_CACHE_AGE_MS,
}: OfflineStorageInspectorProps) {
  const [filter, setFilter] = useState<string>("all");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [storageUsageMB, setStorageUsageMB] = useState<number | null>(null);
  const [storageQuotaMB, setStorageQuotaMB] = useState<number | null>(null);
  const [staleEstimateMB, setStaleEstimateMB] = useState<number>(0);
  const [isPruning, setIsPruning] = useState(false);
  const [confirmationToast, setConfirmationToast] = useState<{
    show: boolean;
    recoveredMB: number;
    deletedCount: number;
  } | null>(null);

  const loadStorageInfo = useCallback(async () => {
    if (
      typeof navigator !== "undefined" &&
      "storage" in navigator &&
      navigator.storage?.estimate
    ) {
      try {
        const { usage, quota } = await navigator.storage.estimate();
        if (usage !== undefined) {
          setStorageUsageMB(Number((usage / (1024 * 1024)).toFixed(2)));
        }
        if (quota !== undefined) {
          setStorageQuotaMB(Number((quota / (1024 * 1024)).toFixed(2)));
        }
      } catch (e) {
        console.warn(
          "[OfflineStorageInspector] Failed to read storage estimate:",
          e,
        );
      }
    }

    try {
      const est = await estimateStaleEntries(maxAgeMs);
      setStaleEstimateMB(est.mb);
    } catch {
      setStaleEstimateMB(0);
    }
  }, [maxAgeMs]);

  useEffect(() => {
    if (isOpen) {
      loadStorageInfo();
    }
  }, [isOpen, loadStorageInfo]);

  if (!isOpen) return null;

  const handleRefresh = async () => {
    if (onRefresh) {
      setIsRefreshing(true);
      await Promise.resolve(onRefresh());
      await loadStorageInfo();
      setIsRefreshing(false);
    }
  };

  const handlePruneStaleCache = async () => {
    try {
      setIsPruning(true);
      const result = await pruneStaleEntries(maxAgeMs);
      setConfirmationToast({
        show: true,
        recoveredMB: result.recoveredMB,
        deletedCount: result.deletedCount,
      });
      if (onPrune) {
        onPrune(result.recoveredMB);
      }
      await loadStorageInfo();
    } catch (err) {
      console.error(
        "[OfflineStorageInspector] Failed pruning stale cache:",
        err,
      );
    } finally {
      setIsPruning(false);
    }
  };

  const filteredLogs = logs.filter((log) => {
    if (filter === "all") return true;
    const logType = (log.type || log.action || "").toLowerCase();
    return logType.includes(filter.toLowerCase());
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-3xl rounded-2xl bg-zinc-900 border border-zinc-800 text-zinc-100 shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 bg-zinc-950/50">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-orange-500/10 text-orange-400">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white">
                Offline Storage Inspector
              </h2>
              <p className="text-xs text-zinc-400">
                View storage consumption, prune stale caches, and manage queued
                operations
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors cursor-pointer"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Storage Consumption & Prune Action Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-3 bg-zinc-950/40 border-b border-zinc-800 text-xs">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 text-zinc-400">
              <HardDrive className="w-3.5 h-3.5 text-orange-400" />
              <span className="font-medium">Quota Used:</span>
            </div>
            <span
              className="font-mono text-zinc-200 bg-zinc-800/80 px-2 py-0.5 rounded border border-zinc-700/60"
              data-testid="storage-consumption-badge"
            >
              {storageUsageMB !== null ? `${storageUsageMB} MB` : "0.0 MB"}
              {storageQuotaMB !== null ? ` / ${storageQuotaMB} MB` : ""}
            </span>
          </div>

          <button
            onClick={handlePruneStaleCache}
            disabled={isPruning}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-orange-600 hover:bg-orange-500 active:bg-orange-700 text-white text-xs font-medium transition-colors shadow-sm disabled:opacity-50 cursor-pointer"
            data-testid="prune-stale-cache-btn"
          >
            {isPruning ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Trash2 className="w-3.5 h-3.5" />
            )}
            <span>Prune Stale Cache (~{staleEstimateMB.toFixed(1)} MB)</span>
          </button>
        </div>

        {/* Confirmation Toast */}
        {confirmationToast?.show && (
          <div
            role="alert"
            data-testid="prune-confirmation-toast"
            className="mx-6 mt-4 p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 flex items-center justify-between text-xs animate-in fade-in slide-in-from-top-2 duration-200"
          >
            <div className="flex items-center gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>
                Successfully pruned stale cache! Recovered{" "}
                <strong>{confirmationToast.recoveredMB} MB</strong> of storage (
                {confirmationToast.deletedCount}{" "}
                {confirmationToast.deletedCount === 1 ? "entry" : "entries"}{" "}
                removed).
              </span>
            </div>
            <button
              onClick={() => setConfirmationToast(null)}
              className="p-1 rounded text-emerald-400 hover:text-white transition-colors cursor-pointer"
              aria-label="Dismiss notification"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Toolbar & Filters */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-3 border-b border-zinc-800 bg-zinc-900/50">
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-400 font-medium">Filter:</span>
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="bg-zinc-800 border border-zinc-700 rounded-lg px-2.5 py-1 text-xs text-zinc-200 focus:outline-none focus:ring-1 focus:ring-orange-500"
            >
              <option value="all">All Operations</option>
              <option value="favorite">Favorites</option>
              <option value="crdt">CRDT Sync</option>
              <option value="rate">Ratings</option>
              <option value="conversation">Conversations</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            {onRefresh && (
              <button
                onClick={handleRefresh}
                disabled={isRefreshing}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium transition-colors disabled:opacity-50"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 ${isRefreshing ? "animate-spin" : ""}`}
                />
                Refresh
              </button>
            )}

            {onClearLogs && (
              <button
                onClick={onClearLogs}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs font-medium transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Clear Log
              </button>
            )}
          </div>
        </div>

        {/* Table Content */}
        <div className="flex-1 overflow-auto p-6">
          {filteredLogs.length === 0 ? (
            <div className="py-12 text-center text-zinc-500">
              <Database className="w-8 h-8 mx-auto mb-2 opacity-40" />
              <p className="text-sm font-medium">
                No offline sync log entries found
              </p>
              <p className="text-xs text-zinc-600 mt-1">
                Pending offline actions will appear here when performed offline.
              </p>
            </div>
          ) : (
            <div className="border border-zinc-800 rounded-xl overflow-hidden bg-zinc-950/40">
              <table className="w-full text-left text-xs">
                <thead className="bg-zinc-900/80 text-zinc-400 font-medium border-b border-zinc-800 uppercase tracking-wider text-[10px]">
                  <tr>
                    <th className="px-4 py-3">Operation</th>
                    <th className="px-4 py-3">Target ID</th>
                    <th className="px-4 py-3">Timestamp</th>
                    <th className="px-4 py-3 text-right">Retries</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60 text-zinc-300">
                  {filteredLogs.map((item, idx) => {
                    const logType = item.type || item.action || "sync";
                    const formattedTime = formatSyncTimestamp(item.timestamp);
                    const isInvalid =
                      formattedTime === "Invalid Date" ||
                      formattedTime === "N/A";

                    return (
                      <tr
                        key={item.id ?? idx}
                        className="hover:bg-zinc-800/40 transition-colors"
                      >
                        <td className="px-4 py-3 font-mono font-medium text-orange-400">
                          {logType}
                        </td>
                        <td className="px-4 py-3 font-mono text-zinc-400 max-w-[150px] truncate">
                          {item.venueId || String(item.id ?? "N/A")}
                        </td>
                        <td className="px-4 py-3 font-medium">
                          <span
                            className={
                              isInvalid
                                ? "text-red-400 bg-red-500/10 px-2 py-0.5 rounded text-[11px]"
                                : "text-zinc-200"
                            }
                          >
                            {formattedTime}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right font-mono">
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold ${
                              (item.retryCount ?? 0) > 0
                                ? "bg-amber-500/10 text-amber-400"
                                : "bg-green-500/10 text-green-400"
                            }`}
                          >
                            {(item.retryCount ?? 0) > 0 ? (
                              <AlertCircle className="w-3 h-3" />
                            ) : (
                              <CheckCircle2 className="w-3 h-3" />
                            )}
                            {item.retryCount ?? 0}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-3 border-t border-zinc-800 bg-zinc-950/50 text-xs text-zinc-500">
          <span>Total Operations: {filteredLogs.length}</span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export default OfflineStorageInspector;

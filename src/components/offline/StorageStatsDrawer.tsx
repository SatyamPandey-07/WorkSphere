"use client";

import React, { useEffect, useState, useCallback } from "react";
import {
  X,
  HardDrive,
  Database,
  Layers,
  RefreshCw,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Info,
  MapPin,
  Sparkles,
} from "lucide-react";
import {
  getCachedFloorPlanStorageStats,
  getStaleFloorPlanCacheStats,
  purgeStaleFloorPlanCache,
  formatBytes,
  type OfflineStorageStats,
  type StaleFloorPlanCacheStats,
} from "@/lib/offlineStorage";
import { getQueuedCheckIns } from "@/lib/offlineStore";
import { syncQueueManager } from "@/lib/offline/SyncQueueManager";

export interface StorageStatsDrawerProps {
  /** Controls drawer open/closed state */
  isOpen: boolean;
  /** Callback fired when drawer requests closing */
  onClose: () => void;
  /** Optional initial storage stats or override */
  initialStats?: OfflineStorageStats | null;
  /** Optional callback fired after stats are refreshed */
  onStatsUpdated?: (stats: OfflineStorageStats) => void;
  /** Optional trigger value to force refresh */
  refreshTrigger?: number | string | boolean;
  /** Optional custom clear cache handler */
  onClearCache?: () => Promise<void> | void;
  /** Optional initial unsynced check-ins count override (e.g. for testing) */
  initialUnsyncedCheckIns?: number;
}

export function StorageStatsDrawer({
  isOpen,
  onClose,
  initialStats = null,
  onStatsUpdated,
  refreshTrigger,
  onClearCache,
  initialUnsyncedCheckIns,
}: StorageStatsDrawerProps) {
  const [stats, setStats] = useState<OfflineStorageStats | null>(initialStats);
  const [loading, setLoading] = useState(!initialStats);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [staleStats, setStaleStats] = useState<StaleFloorPlanCacheStats | null>(
    null,
  );
  const [isCalculatingStale, setIsCalculatingStale] = useState(true);
  const [isPurgingStale, setIsPurgingStale] = useState(false);
  const [showCleanConfirmation, setShowCleanConfirmation] = useState(false);
  const [showClearCacheConfirmation, setShowClearCacheConfirmation] =
    useState(false);
  const [isClearingCache, setIsClearingCache] = useState(false);
  const [unsyncedCheckIns, setUnsyncedCheckIns] = useState<number>(
    initialUnsyncedCheckIns ?? 0,
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const fetchStats = useCallback(async () => {
    try {
      const data = await getCachedFloorPlanStorageStats();
      setStats(data);
      setErrorMessage(null);
      onStatsUpdated?.(data);
    } catch (err) {
      console.error("[StorageStatsDrawer] Failed to fetch storage stats:", err);
      setErrorMessage("Unable to retrieve storage quota details.");
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, [onStatsUpdated]);

  const fetchStaleStats = useCallback(async () => {
    setIsCalculatingStale(true);
    try {
      const data = await getStaleFloorPlanCacheStats();
      setStaleStats(data);
    } catch (err) {
      console.error(
        "[StorageStatsDrawer] Failed to calculate stale cache:",
        err,
      );
    } finally {
      setIsCalculatingStale(false);
    }
  }, []);

  const fetchUnsyncedCheckIns = useCallback(async () => {
    if (initialUnsyncedCheckIns !== undefined) {
      setUnsyncedCheckIns(initialUnsyncedCheckIns);
      return;
    }
    let count = 0;
    try {
      const queued = await getQueuedCheckIns();
      count = Math.max(count, queued?.length ?? 0);
    } catch {
      // IndexedDB uninitialized or restricted
    }
    try {
      const syncItems = await syncQueueManager.getQueue("checkin");
      count = Math.max(count, syncItems?.length ?? 0);
    } catch {
      // SyncQueueManager fallback
    }
    setUnsyncedCheckIns(count);
  }, [initialUnsyncedCheckIns]);

  useEffect(() => {
    if (isOpen) {
      fetchStats();
      fetchStaleStats();
      fetchUnsyncedCheckIns();
      setSuccessMessage(null);
    }
  }, [
    isOpen,
    fetchStats,
    fetchStaleStats,
    fetchUnsyncedCheckIns,
    refreshTrigger,
  ]);

  // Handle ESC key to close modals or drawer
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (showClearCacheConfirmation) {
          setShowClearCacheConfirmation(false);
          return;
        }
        if (showCleanConfirmation) {
          setShowCleanConfirmation(false);
          return;
        }
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, showClearCacheConfirmation, showCleanConfirmation, onClose]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    setErrorMessage(null);
    await Promise.all([
      fetchStats(),
      fetchStaleStats(),
      fetchUnsyncedCheckIns(),
    ]);
  };

  const handlePurgeStale = async () => {
    setIsPurgingStale(true);
    setErrorMessage(null);
    try {
      await purgeStaleFloorPlanCache();
      setShowCleanConfirmation(false);
      setSuccessMessage("Stale cache successfully purged!");
      await Promise.all([
        fetchStats(),
        fetchStaleStats(),
        fetchUnsyncedCheckIns(),
      ]);
      setTimeout(() => setSuccessMessage(null), 4000);
    } catch (err) {
      console.error("[StorageStatsDrawer] Failed to purge stale cache:", err);
      setErrorMessage("Failed to clean stale cache. Please try again.");
    } finally {
      setIsPurgingStale(false);
    }
  };

  const handleConfirmClearCache = async () => {
    setIsClearingCache(true);
    setErrorMessage(null);
    try {
      if (onClearCache) {
        await onClearCache();
      } else {
        // Clear window service worker caches if available
        if (typeof window !== "undefined" && "caches" in window) {
          try {
            const cacheKeys = await caches.keys();
            await Promise.all(cacheKeys.map((key) => caches.delete(key)));
          } catch (e) {
            console.warn("[StorageStatsDrawer] Failed to clear caches:", e);
          }
        }

        // Clear IndexedDB databases
        if (typeof window !== "undefined" && "indexedDB" in window) {
          try {
            const dbNames = ["WorkSphereOfflineDB", "WorkSphereOfflineCache"];
            for (const name of dbNames) {
              const req = indexedDB.deleteDatabase(name);
              await new Promise<void>((resolve) => {
                req.onsuccess = () => resolve();
                req.onerror = () => resolve();
                req.onblocked = () => resolve();
              });
            }
          } catch (e) {
            console.warn("[StorageStatsDrawer] Failed to clear IndexedDB:", e);
          }
        }
      }

      setShowClearCacheConfirmation(false);
      setSuccessMessage("Offline cache successfully cleared!");
      await Promise.all([
        fetchStats(),
        fetchStaleStats(),
        fetchUnsyncedCheckIns(),
      ]);
      setTimeout(() => setSuccessMessage(null), 4000);
    } catch (err) {
      console.error("[StorageStatsDrawer] Failed to clear offline cache:", err);
      setErrorMessage("Failed to clear offline cache. Please try again.");
    } finally {
      setIsClearingCache(false);
    }
  };

  if (!isOpen) return null;

  const {
    usageBytes = 0,
    quotaBytes = 0,
    usagePercent = 0,
    floorPlanBytes = 0,
    floorPlanCount = 0,
    floorPlanPercentOfUsage = 0,
    floorPlanPercentOfQuota: _floorPlanPercentOfQuota = 0,
    isEstimateAvailable = false,
  } = stats || {};

  const clampedUsagePercent = Math.min(100, Math.max(0, usagePercent));
  const otherUsageBytes = Math.max(0, usageBytes - floorPlanBytes);
  const formattedTotalUsage = formatBytes(usageBytes);
  const formattedQuota = quotaBytes > 0 ? formatBytes(quotaBytes) : "Unlimited";
  const formattedFloorPlanBytes = formatBytes(floorPlanBytes);
  const formattedOtherBytes = formatBytes(otherUsageBytes);

  // Dynamic color for quota progress bar
  const getProgressBarColor = (percent: number) => {
    if (percent > 90) return "bg-red-500 shadow-red-500/30";
    if (percent > 70) return "bg-amber-500 shadow-amber-500/30";
    return "bg-gradient-to-r from-emerald-500 to-teal-500 shadow-emerald-500/20";
  };

  const getStatusBadge = () => {
    if (clampedUsagePercent > 90) {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-red-500/10 text-red-500 dark:text-red-400 border border-red-500/20">
          <AlertTriangle className="w-3.5 h-3.5" /> Quota Warning
        </span>
      );
    }
    if (clampedUsagePercent > 70) {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-500 dark:text-amber-400 border border-amber-500/20">
          <AlertTriangle className="w-3.5 h-3.5" /> Heavy Usage
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
        <CheckCircle2 className="w-3.5 h-3.5" /> Healthy
      </span>
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-xs transition-opacity duration-300"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="storage-stats-drawer-title"
    >
      <div
        className="w-full max-w-md h-full bg-white dark:bg-zinc-900 border-l border-zinc-200 dark:border-zinc-800 shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-right duration-300"
        data-testid="storage-stats-drawer"
      >
        {/* Drawer Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-950/50">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400">
              <HardDrive className="w-5 h-5" />
            </div>
            <div>
              <h2
                id="storage-stats-drawer-title"
                className="text-base font-bold text-zinc-900 dark:text-zinc-100"
              >
                Storage & Quota Stats
              </h2>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Offline persistence and cache allocation
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleRefresh}
              disabled={isRefreshing}
              aria-label="Refresh storage stats"
              className="p-2 rounded-xl text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50"
            >
              <RefreshCw
                className={`w-4 h-4 ${isRefreshing ? "animate-spin text-blue-500" : ""}`}
              />
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close storage stats drawer"
              className="p-2 rounded-xl text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Drawer Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {loading ? (
            <div className="py-12 flex flex-col items-center justify-center gap-3 text-zinc-400">
              <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
              <p className="text-sm font-medium">
                Estimating browser storage quota…
              </p>
            </div>
          ) : (
            <>
              {/* Status Header Banner */}
              <div className="flex items-center justify-between p-4 rounded-2xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200/80 dark:border-zinc-800">
                <div>
                  <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                    Storage Health
                  </span>
                  <div className="text-lg font-bold text-zinc-900 dark:text-zinc-100 mt-0.5">
                    {clampedUsagePercent.toFixed(1)}% Quota Used
                  </div>
                </div>
                {getStatusBadge()}
              </div>

              {/* Storage Usage Progress Bar Indicator */}
              <div className="space-y-2 p-4 rounded-2xl bg-zinc-50/80 dark:bg-zinc-800/40 border border-zinc-200/80 dark:border-zinc-800/80">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5">
                    <Database className="w-3.5 h-3.5 text-blue-500" />
                    Storage Usage Progress
                  </span>
                  <span className="font-mono text-zinc-600 dark:text-zinc-300">
                    {formattedTotalUsage} / {formattedQuota}
                  </span>
                </div>

                {/* Main Progress Bar Indicator */}
                <div
                  role="progressbar"
                  aria-valuenow={Math.round(clampedUsagePercent)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label="Storage usage progress indicator"
                  className="relative w-full h-3.5 bg-zinc-200 dark:bg-zinc-800 rounded-full overflow-hidden shadow-inner"
                >
                  <div
                    className={`h-full rounded-full transition-all duration-500 ease-out ${getProgressBarColor(
                      clampedUsagePercent,
                    )}`}
                    style={{
                      width: `${Math.min(100, Math.max(clampedUsagePercent > 0 ? clampedUsagePercent : 1, 0))}%`,
                    }}
                  />
                </div>

                {/* Sub-progress Multi-segment Breakdown */}
                {usageBytes > 0 && (
                  <div className="pt-2">
                    <div className="flex items-center justify-between text-[11px] text-zinc-500 dark:text-zinc-400 mb-1">
                      <span>Breakdown by Data Type</span>
                      <span>
                        {floorPlanPercentOfUsage.toFixed(0)}% floor plans
                      </span>
                    </div>
                    <div className="h-2 w-full bg-zinc-200 dark:bg-zinc-800 rounded-full overflow-hidden flex">
                      <div
                        className="h-full bg-indigo-500 transition-all duration-500"
                        style={{
                          width: `${Math.min(100, floorPlanPercentOfUsage)}%`,
                        }}
                        title={`Floor Plans: ${formattedFloorPlanBytes}`}
                      />
                      <div
                        className="h-full bg-blue-500 transition-all duration-500"
                        style={{
                          width: `${Math.min(100, Math.max(0, 100 - floorPlanPercentOfUsage))}%`,
                        }}
                        title={`Other App Data: ${formattedOtherBytes}`}
                      />
                    </div>
                    <div className="flex items-center gap-4 mt-2 text-[11px] text-zinc-600 dark:text-zinc-400">
                      <span className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-indigo-500" />
                        Floor Plans ({formattedFloorPlanBytes})
                      </span>
                      <span className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-blue-500" />
                        Other Cache ({formattedOtherBytes})
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* Breakdown Metric Cards */}
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3.5 rounded-xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700/60">
                  <div className="flex items-center gap-1.5 text-xs text-indigo-600 dark:text-indigo-400 font-semibold mb-1">
                    <Layers className="w-4 h-4" />
                    Cached Plans
                  </div>
                  <div className="text-xl font-bold text-zinc-900 dark:text-zinc-100">
                    {floorPlanCount}
                  </div>
                  <div className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5">
                    {formattedFloorPlanBytes} stored
                  </div>
                </div>

                <div className="p-3.5 rounded-xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700/60">
                  <div className="flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400 font-semibold mb-1">
                    <MapPin className="w-4 h-4" />
                    Total Footprint
                  </div>
                  <div className="text-xl font-bold text-zinc-900 dark:text-zinc-100">
                    {formattedTotalUsage}
                  </div>
                  <div className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5">
                    of {formattedQuota}
                  </div>
                </div>
              </div>

              {/* Clean Stale Floor Plans Section */}
              <div className="p-4 rounded-2xl bg-amber-50/70 dark:bg-amber-950/20 border border-amber-200/80 dark:border-amber-900/50 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-xs font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                      Stale Cache Cleanup
                    </h3>
                    {isCalculatingStale ? (
                      <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1 flex items-center gap-1.5">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        Scanning for unaccessed plans…
                      </p>
                    ) : (
                      <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-1">
                        {staleStats?.count
                          ? `${(staleStats.reclaimableBytes / (1024 * 1024)).toFixed(2)} MB reclaimable from ${staleStats.count} plan${staleStats.count === 1 ? "" : "s"} older than 30 days.`
                          : "No stale floor plans found. Storage is optimized."}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowCleanConfirmation(true)}
                    disabled={
                      isCalculatingStale || isPurgingStale || !staleStats?.count
                    }
                    className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Clean
                  </button>
                </div>

                {successMessage && (
                  <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" /> {successMessage}
                  </p>
                )}

                {errorMessage && (
                  <p
                    className="text-xs text-red-600 dark:text-red-400"
                    role="alert"
                  >
                    {errorMessage}
                  </p>
                )}
              </div>

              {/* Clear Offline Cache Section */}
              <div className="p-4 rounded-2xl bg-red-50/70 dark:bg-red-950/20 border border-red-200/80 dark:border-red-900/50 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-xs font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
                      <Trash2 className="w-3.5 h-3.5 text-red-500" />
                      Clear Offline Cache
                    </h3>
                    <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-1">
                      Wipe local IndexedDB databases, stored venues, and cached
                      assets.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowClearCacheConfirmation(true)}
                    disabled={isClearingCache || loading}
                    className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Clear Offline Cache
                  </button>
                </div>
              </div>

              {/* Information Note */}
              <div className="flex items-start gap-2 p-3 rounded-xl bg-zinc-100 dark:bg-zinc-800/40 text-zinc-500 dark:text-zinc-400 text-xs">
                <Info className="w-4 h-4 shrink-0 text-zinc-400 mt-0.5" />
                <span>
                  {isEstimateAvailable
                    ? "Storage estimates are measured via the browser StorageManager API. WorkSphere automatically caches visited venues and floor plans for offline availability."
                    : "Estimated storage values are simulated when navigator.storage is restricted."}
                </span>
              </div>
            </>
          )}
        </div>

        {/* Drawer Footer */}
        <div className="p-4 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-950/50">
          <button
            type="button"
            onClick={onClose}
            className="w-full py-2.5 px-4 rounded-xl bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 text-sm font-semibold transition-colors"
          >
            Close Drawer
          </button>
        </div>
      </div>

      {/* Clean Stale Floor Plans Confirmation Modal */}
      {showCleanConfirmation && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !isPurgingStale) {
              setShowCleanConfirmation(false);
            }
          }}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-5 shadow-2xl dark:border-zinc-800 dark:bg-zinc-900"
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-purge-title"
          >
            <h4
              id="confirm-purge-title"
              className="text-base font-semibold text-zinc-900 dark:text-zinc-100"
            >
              Clean stale floor plans?
            </h4>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
              This will remove {staleStats?.count ?? 0} cached floor plan
              {staleStats?.count === 1 ? "" : "s"} not accessed in 30 days,
              freeing approximately{" "}
              {((staleStats?.reclaimableBytes ?? 0) / (1024 * 1024)).toFixed(2)}{" "}
              MB.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowCleanConfirmation(false)}
                disabled={isPurgingStale}
                className="px-4 py-2 text-sm font-medium rounded-xl border border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handlePurgeStale}
                disabled={isPurgingStale}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-xl bg-blue-600 hover:bg-blue-700 text-white transition-colors"
              >
                {isPurgingStale ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Trash2 className="w-4 h-4" />
                )}
                {isPurgingStale ? "Cleaning…" : "Clean cache"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Clear Offline Cache Confirmation Modal */}
      {showClearCacheConfirmation && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !isClearingCache) {
              setShowClearCacheConfirmation(false);
            }
          }}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-5 shadow-2xl dark:border-zinc-800 dark:bg-zinc-900"
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-clear-cache-title"
          >
            <div className="flex items-center gap-2.5 text-red-600 dark:text-red-400">
              <div className="p-2 rounded-xl bg-red-100 dark:bg-red-950/50">
                <Trash2 className="w-5 h-5" />
              </div>
              <h4
                id="confirm-clear-cache-title"
                className="text-base font-semibold text-zinc-900 dark:text-zinc-100"
              >
                Clear Offline Cache?
              </h4>
            </div>

            <div className="mt-3 space-y-3">
              <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">
                This action will delete all locally cached venues, floor plans,
                and offline IndexedDB data.
              </p>

              {/* Formatted byte size readout */}
              <div
                data-testid="free-up-bytes-badge"
                className="flex items-center gap-2 p-3 rounded-xl bg-zinc-100 dark:bg-zinc-800/60 text-zinc-800 dark:text-zinc-200 text-xs font-semibold"
              >
                <HardDrive className="w-4 h-4 text-blue-500 shrink-0" />
                <span>
                  Free up {(usageBytes / (1024 * 1024)).toFixed(1)} MB
                </span>
                <span className="text-zinc-400 dark:text-zinc-500 font-normal ml-auto">
                  ({formattedTotalUsage})
                </span>
              </div>

              {/* Unsaved offline changes warning */}
              {unsyncedCheckIns > 0 ? (
                <div
                  role="alert"
                  data-testid="unsaved-changes-warning"
                  className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/60 text-amber-800 dark:text-amber-200 text-xs space-y-1"
                >
                  <div className="flex items-center gap-1.5 font-bold text-amber-900 dark:text-amber-100">
                    <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
                    Unsaved Offline Changes Detected
                  </div>
                  <p className="leading-relaxed">
                    Warning: You have {unsyncedCheckIns} unsynced offline
                    check-in draft{unsyncedCheckIns === 1 ? "" : "s"}. Unsaved
                    offline changes will be discarded.
                  </p>
                </div>
              ) : null}
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowClearCacheConfirmation(false)}
                disabled={isClearingCache}
                className="px-4 py-2 text-sm font-medium rounded-xl border border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmClearCache}
                disabled={isClearingCache}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-xl bg-red-600 hover:bg-red-700 text-white transition-colors disabled:opacity-50"
              >
                {isClearingCache ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Trash2 className="w-4 h-4" />
                )}
                {isClearingCache ? "Clearing…" : "Clear Cache"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default StorageStatsDrawer;

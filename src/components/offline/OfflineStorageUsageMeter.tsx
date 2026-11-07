"use client";

import React, { useEffect, useState, useCallback, useRef } from "react";
import {
  HardDrive,
  Layers,
  RefreshCw,
  Database,
  PieChart,
  Info,
  CheckCircle2,
  AlertTriangle,
  Trash2,
  Loader2,
} from "lucide-react";
import {
  getCachedFloorPlanStorageStats,
  getStaleFloorPlanCacheStats,
  purgeStaleFloorPlanCache,
  formatBytes,
  type OfflineStorageStats,
  type StaleFloorPlanCacheStats,
} from "@/lib/offlineStorage";

export interface OfflineStorageUsageMeterProps {
  /** Optional custom class name */
  className?: string;
  /** Whether to show compact variant without expanded detail cards */
  compact?: boolean;
  /** Callback fired after stats are refreshed */
  onStatsUpdated?: (stats: OfflineStorageStats) => void;
  /** External trigger to refresh */
  refreshTrigger?: number | string | boolean;
}

export function OfflineStorageUsageMeter({
  className = "",
  compact = false,
  onStatsUpdated,
  refreshTrigger,
}: OfflineStorageUsageMeterProps) {
  const [stats, setStats] = useState<OfflineStorageStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [staleStats, setStaleStats] = useState<StaleFloorPlanCacheStats | null>(null);
  const [isCalculatingStale, setIsCalculatingStale] = useState(true);
  const [isPurgingStale, setIsPurgingStale] = useState(false);
  const [showCleanConfirmation, setShowCleanConfirmation] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [cleanupError, setCleanupError] = useState<string | null>(null);

  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const fetchStats = useCallback(async () => {
    try {
      const data = await getCachedFloorPlanStorageStats();
      if (!isMountedRef.current) return;
      setStats(data);
      setStorageError(null);
      onStatsUpdated?.(data);
    } catch (err) {
      if (!isMountedRef.current) return;
      console.error("[OfflineStorageUsageMeter] Failed to fetch storage stats:", err);
      setStorageError("Unable to refresh offline storage usage.");
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
        setIsRefreshing(false);
      }
    }
  }, [onStatsUpdated]);

  const fetchStaleStats = useCallback(async () => {
    if (isMountedRef.current) {
      setIsCalculatingStale(true);
    }
    try {
      const data = await getStaleFloorPlanCacheStats();
      if (!isMountedRef.current) return;
      setStaleStats(data);
      setCleanupError(null);
    } catch (err) {
      if (!isMountedRef.current) return;
      console.error("[OfflineStorageUsageMeter] Failed to calculate stale cache:", err);
      setCleanupError("Unable to inspect stale floor plans. Please try again.");
    } finally {
      if (isMountedRef.current) {
        setIsCalculatingStale(false);
      }
    }
  }, []);

  useEffect(() => {
    fetchStats();
    fetchStaleStats();
  }, [fetchStats, fetchStaleStats, refreshTrigger]);

  // Handle keyboard Escape dismissal on confirmation modal
  useEffect(() => {
    if (!showCleanConfirmation) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isPurgingStale) {
        setShowCleanConfirmation(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showCleanConfirmation, isPurgingStale]);

  const handleRefresh = async () => {
    if (!isMountedRef.current) return;
    setIsRefreshing(true);
    setStorageError(null);
    await Promise.all([fetchStats(), fetchStaleStats()]);
  };

  const handlePurgeStaleCache = async () => {
    if (!isMountedRef.current) return;
    setIsPurgingStale(true);
    setCleanupError(null);
    try {
      await purgeStaleFloorPlanCache();
      if (!isMountedRef.current) return;
      setShowCleanConfirmation(false);
      await Promise.all([fetchStats(), fetchStaleStats()]);
    } catch (err) {
      if (!isMountedRef.current) return;
      console.error("[OfflineStorageUsageMeter] Failed to purge stale floorplans:", err);
      setCleanupError("Unable to clean stale floor plans. Please try again.");
    } finally {
      if (isMountedRef.current) {
        setIsPurgingStale(false);
      }
    }
  };

  if (loading && !stats) {
    return (
      <div
        className={`p-4 rounded-2xl bg-zinc-50 dark:bg-zinc-900/80 border border-zinc-200 dark:border-zinc-800 animate-pulse ${className}`}
        aria-busy="true"
        aria-label="Loading storage usage meter"
        data-testid="storage-meter-loading"
      >
        <div className="h-4 bg-zinc-200 dark:bg-zinc-800 rounded w-1/3 mb-3" />
        <div className="h-3 bg-zinc-200 dark:bg-zinc-800 rounded-full w-full mb-2" />
        <div className="h-3 bg-zinc-200 dark:bg-zinc-800 rounded w-1/2" />
      </div>
    );
  }

  const {
    usageBytes = 0,
    quotaBytes = 0,
    usagePercent = 0,
    floorPlanBytes = 0,
    floorPlanCount = 0,
    floorPlanPercentOfUsage = 0,
    isEstimateAvailable = false,
  } = stats || {};

  const safeUsageBytes =
    typeof usageBytes === "number" && Number.isFinite(usageBytes) && usageBytes >= 0
      ? usageBytes
      : 0;
  const safeQuotaBytes =
    typeof quotaBytes === "number" && Number.isFinite(quotaBytes) && quotaBytes >= 0
      ? quotaBytes
      : 0;
  const safeUsagePercent =
    typeof usagePercent === "number" && Number.isFinite(usagePercent)
      ? Math.max(0, Math.min(100, usagePercent))
      : 0;
  const safeFloorPlanBytes =
    typeof floorPlanBytes === "number" && Number.isFinite(floorPlanBytes) && floorPlanBytes >= 0
      ? floorPlanBytes
      : 0;
  const safeFloorPlanCount =
    typeof floorPlanCount === "number" && Number.isFinite(floorPlanCount) && floorPlanCount >= 0
      ? floorPlanCount
      : 0;
  const safeFloorPlanPercentOfUsage =
    typeof floorPlanPercentOfUsage === "number" && Number.isFinite(floorPlanPercentOfUsage)
      ? Math.max(0, Math.min(100, floorPlanPercentOfUsage))
      : 0;

  // Color thresholds based on quota utilization
  const getProgressColor = (percent: number) => {
    if (percent > 90) return "bg-red-500 shadow-red-500/30";
    if (percent > 70) return "bg-amber-500 shadow-amber-500/30";
    return "bg-gradient-to-r from-blue-500 to-indigo-500 shadow-blue-500/20";
  };

  const getStatusBadge = () => {
    if (safeUsagePercent > 90) {
      return (
        <span
          data-testid="storage-meter-status-badge"
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 dark:bg-red-950/60 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-900/50"
        >
          <AlertTriangle className="w-3 h-3" /> Quota Warning
        </span>
      );
    }
    if (safeUsagePercent > 70) {
      return (
        <span
          data-testid="storage-meter-status-badge"
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-900/50"
        >
          <AlertTriangle className="w-3 h-3" /> Heavy Usage
        </span>
      );
    }
    return (
      <span
        data-testid="storage-meter-status-badge"
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-900/50"
      >
        <CheckCircle2 className="w-3 h-3" /> Healthy
      </span>
    );
  };

  const otherUsageBytes = Math.max(0, safeUsageBytes - safeFloorPlanBytes);
  const formattedFloorPlanBytes = formatBytes(safeFloorPlanBytes);
  const formattedTotalUsage = formatBytes(safeUsageBytes);
  const formattedQuota = safeQuotaBytes > 0 ? formatBytes(safeQuotaBytes) : "Unlimited";
  const formattedUsagePercent = safeUsagePercent.toFixed(1);

  return (
    <div
      className={`rounded-2xl bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-4 sm:p-5 transition-all duration-200 ${className}`}
      data-testid="offline-storage-usage-meter"
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-blue-500/10 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400">
            <HardDrive className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Offline Storage Meter
            </h3>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {getStatusBadge()}
          <button
            type="button"
            data-testid="storage-meter-refresh-btn"
            onClick={handleRefresh}
            disabled={isRefreshing}
            title="Refresh storage quota estimation"
            aria-label="Refresh storage quota estimation"
            className="p-1 rounded-md text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? "animate-spin text-blue-500" : ""}`} />
          </button>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="space-y-1.5 my-3">
        <div className="flex items-center justify-between text-xs text-zinc-600 dark:text-zinc-400">
          <span className="font-medium">Quota Used</span>
          <span className="font-semibold text-zinc-900 dark:text-zinc-200">
            {formattedTotalUsage} / {formattedQuota}{" "}
            <span className="text-zinc-500 font-normal">({formattedUsagePercent}%)</span>
          </span>
        </div>

        {/* Visual Multi-Segment Bar */}
        <div
          role="progressbar"
          data-testid="storage-meter-progressbar"
          aria-valuenow={Math.round(safeUsagePercent)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Browser offline storage quota usage"
          className="relative w-full h-3 bg-zinc-200 dark:bg-zinc-800 rounded-full overflow-hidden shadow-inner"
        >
          {/* Progress bar container */}
          <div
            className={`h-full rounded-full transition-all duration-500 ease-out ${getProgressColor(
              safeUsagePercent,
            )}`}
            style={{
              width: `${Math.min(100, Math.max(safeUsagePercent > 0 ? safeUsagePercent : 1, 0))}%`,
            }}
          />
        </div>
      </div>

      {/* Breakdown Metrics */}
      <div className="grid grid-cols-2 gap-2.5 mt-3 pt-3 border-t border-zinc-200/80 dark:border-zinc-800/80">
        {/* Floor Plans Card */}
        <div
          data-testid="storage-meter-floorplan-card"
          className="bg-white dark:bg-zinc-800/70 rounded-xl p-2.5 border border-zinc-200/70 dark:border-zinc-700/50 flex flex-col justify-between"
        >
          <div className="flex items-center justify-between text-xs text-indigo-600 dark:text-indigo-400 font-medium mb-1">
            <span className="flex items-center gap-1">
              <Layers className="w-3.5 h-3.5 text-indigo-500" />
              Cached Floor Plans
            </span>
          </div>
          <div>
            <div className="text-base font-bold text-zinc-900 dark:text-zinc-100 leading-tight">
              {formattedFloorPlanBytes}
            </div>
            <div className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5 flex items-center justify-between">
              <span>{safeFloorPlanCount} plan{safeFloorPlanCount === 1 ? "" : "s"} saved</span>
              {safeUsageBytes > 0 && (
                <span className="font-medium text-indigo-600 dark:text-indigo-300">
                  {safeFloorPlanPercentOfUsage.toFixed(0)}% of cache
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Total Cache / Other Store Card */}
        <div
          data-testid="storage-meter-total-card"
          className="bg-white dark:bg-zinc-800/70 rounded-xl p-2.5 border border-zinc-200/70 dark:border-zinc-700/50 flex flex-col justify-between"
        >
          <div className="flex items-center justify-between text-xs text-blue-600 dark:text-blue-400 font-medium mb-1">
            <span className="flex items-center gap-1">
              <Database className="w-3.5 h-3.5 text-blue-500" />
              Total Storage
            </span>
          </div>
          <div>
            <div className="text-base font-bold text-zinc-900 dark:text-zinc-100 leading-tight">
              {formattedTotalUsage}
            </div>
            <div className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5 flex items-center justify-between">
              <span>{otherUsageBytes > 0 ? formatBytes(otherUsageBytes) : "0 B"} other data</span>
              <span className="font-medium text-blue-600 dark:text-blue-300">
                {formattedUsagePercent}% quota
              </span>
            </div>
          </div>
        </div>
      </div>

      {storageError && (
        <p
          data-testid="storage-meter-storage-error"
          className="mt-3 text-xs text-red-600 dark:text-red-400"
          role="alert"
        >
          {storageError}
        </p>
      )}

      <div className="mt-3 rounded-xl border border-amber-200/80 dark:border-amber-900/50 bg-amber-50/70 dark:bg-amber-950/20 p-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">
              Clean Stale Cache
            </p>
            {isCalculatingStale ? (
              <p className="mt-1 flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                <Loader2 className="h-3 w-3 animate-spin" />
                Calculating reclaimable storage…
              </p>
            ) : (
              <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                {staleStats?.count
                  ? `${(staleStats.reclaimableBytes / (1024 * 1024)).toFixed(2)} MB reclaimable from ${staleStats.count} stale floor plan${staleStats.count === 1 ? "" : "s"}`
                  : "No stale floor plans found"}
              </p>
            )}
          </div>
          <button
            type="button"
            data-testid="storage-meter-clean-btn"
            onClick={() => {
              setCleanupError(null);
              setShowCleanConfirmation(true);
            }}
            disabled={isCalculatingStale || isPurgingStale || !staleStats?.count}
            className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Clean
          </button>
        </div>
        {cleanupError && (
          <p
            data-testid="storage-meter-cleanup-error"
            className="mt-2 text-xs text-red-600 dark:text-red-400"
            role="alert"
          >
            {cleanupError}
          </p>
        )}
      </div>

      {!compact && (
        <div className="mt-3 flex items-start gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400 bg-zinc-100/70 dark:bg-zinc-800/40 rounded-lg p-2">
          <Info className="w-3.5 h-3.5 text-zinc-400 shrink-0 mt-0.5" />
          <span>
            {isEstimateAvailable
              ? "Calculated dynamically via navigator.storage.estimate(). Stale floor plans are automatically purged on low storage."
              : "Storage quota estimation is emulated for this browser environment."}
          </span>
        </div>
      )}

      {showCleanConfirmation && (
        <div
          data-testid="clean-stale-cache-overlay"
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !isPurgingStale) {
              setShowCleanConfirmation(false);
            }
          }}
        >
          <div
            data-testid="clean-stale-cache-dialog"
            className="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-5 shadow-2xl dark:border-zinc-800 dark:bg-zinc-900"
            role="dialog"
            aria-modal="true"
            aria-labelledby="clean-stale-cache-title"
            aria-describedby="clean-stale-cache-description"
          >
            <h4
              id="clean-stale-cache-title"
              className="text-base font-semibold text-zinc-900 dark:text-zinc-100"
            >
              Clean stale floor plans?
            </h4>
            <p
              id="clean-stale-cache-description"
              className="mt-2 text-sm text-zinc-600 dark:text-zinc-400"
            >
              This removes {staleStats?.count ?? 0} floor plan
              {staleStats?.count === 1 ? "" : "s"} that have not been accessed in 30 days.
              Approximately{" "}
              {((staleStats?.reclaimableBytes ?? 0) / (1024 * 1024)).toFixed(2)} MB may be
              reclaimed. Cached venue details will be kept.
            </p>
            {cleanupError && (
              <p
                data-testid="clean-stale-cache-error"
                className="mt-3 text-sm text-red-600 dark:text-red-400"
                role="alert"
              >
                {cleanupError}
              </p>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                data-testid="clean-stale-cancel-btn"
                onClick={() => setShowCleanConfirmation(false)}
                disabled={isPurgingStale}
                className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-blue-500"
              >
                Cancel
              </button>
              <button
                type="button"
                data-testid="clean-stale-confirm-btn"
                onClick={handlePurgeStaleCache}
                disabled={isPurgingStale}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-50 dark:focus-visible:ring-offset-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-blue-500"
              >
                {isPurgingStale ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
                {isPurgingStale ? "Cleaning…" : "Clean cache"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default OfflineStorageUsageMeter;

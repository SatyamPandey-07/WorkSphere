"use client";

import React, { useEffect, useState, useCallback } from "react";
import {
  HardDrive,
  Layers,
  RefreshCw,
  Database,
  PieChart,
  Info,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import {
  getCachedFloorPlanStorageStats,
  formatBytes,
  type OfflineStorageStats,
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

  const fetchStats = useCallback(async () => {
    try {
      const data = await getCachedFloorPlanStorageStats();
      setStats(data);
      onStatsUpdated?.(data);
    } catch (err) {
      console.error("[OfflineStorageUsageMeter] Failed to fetch storage stats:", err);
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, [onStatsUpdated]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats, refreshTrigger]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await fetchStats();
  };

  if (loading && !stats) {
    return (
      <div
        className={`p-4 rounded-2xl bg-zinc-50 dark:bg-zinc-900/80 border border-zinc-200 dark:border-zinc-800 animate-pulse ${className}`}
        aria-busy="true"
        aria-label="Loading storage usage meter"
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

  // Color thresholds based on quota utilization
  const getProgressColor = (percent: number) => {
    if (percent > 90) return "bg-red-500 shadow-red-500/30";
    if (percent > 70) return "bg-amber-500 shadow-amber-500/30";
    return "bg-gradient-to-r from-blue-500 to-indigo-500 shadow-blue-500/20";
  };

  const getStatusBadge = () => {
    if (usagePercent > 90) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 dark:bg-red-950/60 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-900/50">
          <AlertTriangle className="w-3 h-3" /> Quota Warning
        </span>
      );
    }
    if (usagePercent > 70) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-900/50">
          <AlertTriangle className="w-3 h-3" /> Heavy Usage
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-900/50">
        <CheckCircle2 className="w-3 h-3" /> Healthy
      </span>
    );
  };

  const otherUsageBytes = Math.max(0, usageBytes - floorPlanBytes);
  const formattedFloorPlanBytes = formatBytes(floorPlanBytes);
  const formattedTotalUsage = formatBytes(usageBytes);
  const formattedQuota = quotaBytes > 0 ? formatBytes(quotaBytes) : "Unlimited";
  const formattedUsagePercent = usagePercent.toFixed(1);

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
          aria-valuenow={Math.round(usagePercent)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Browser offline storage quota usage"
          className="relative w-full h-3 bg-zinc-200 dark:bg-zinc-800 rounded-full overflow-hidden shadow-inner"
        >
          {/* Progress bar container */}
          <div
            className={`h-full rounded-full transition-all duration-500 ease-out ${getProgressColor(
              usagePercent,
            )}`}
            style={{
              width: `${Math.min(100, Math.max(usagePercent > 0 ? usagePercent : 1, 0))}%`,
            }}
          />
        </div>
      </div>

      {/* Breakdown Metrics */}
      <div className="grid grid-cols-2 gap-2.5 mt-3 pt-3 border-t border-zinc-200/80 dark:border-zinc-800/80">
        {/* Floor Plans Card */}
        <div className="bg-white dark:bg-zinc-800/70 rounded-xl p-2.5 border border-zinc-200/70 dark:border-zinc-700/50 flex flex-col justify-between">
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
              <span>{floorPlanCount} plan{floorPlanCount === 1 ? "" : "s"} saved</span>
              {usageBytes > 0 && (
                <span className="font-medium text-indigo-600 dark:text-indigo-300">
                  {floorPlanPercentOfUsage.toFixed(0)}% of cache
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Total Cache / Other Store Card */}
        <div className="bg-white dark:bg-zinc-800/70 rounded-xl p-2.5 border border-zinc-200/70 dark:border-zinc-700/50 flex flex-col justify-between">
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
    </div>
  );
}

export default OfflineStorageUsageMeter;

"use client";

import React, { useState, useMemo } from "react";
import {
  HardDrive,
  AlertTriangle,
  Layers,
  Database,
  Archive,
  CheckCircle2,
  PieChart,
  SlidersHorizontal,
} from "lucide-react";
import type { VenuePartitionDetails } from "@/lib/adminPartitionService";

export interface PartitionDiskStorageUsageBarProps {
  partitions: VenuePartitionDetails[];
  totalSizeBytes?: number;
  totalSizePretty?: string;
  onFilterByParent?: (parentTable: string) => void;
  onFilterByStatus?: (status: string) => void;
}

const TABLE_PALETTE = [
  { bg: "bg-violet-500", text: "text-violet-400", border: "border-violet-500/30", fill: "#8b5cf6" },
  { bg: "bg-cyan-500", text: "text-cyan-400", border: "border-cyan-500/30", fill: "#06b6d4" },
  { bg: "bg-emerald-500", text: "text-emerald-400", border: "border-emerald-500/30", fill: "#10b981" },
  { bg: "bg-amber-500", text: "text-amber-400", border: "border-amber-500/30", fill: "#f59e0b" },
  { bg: "bg-pink-500", text: "text-pink-400", border: "border-pink-500/30", fill: "#ec4899" },
  { bg: "bg-blue-500", text: "text-blue-400", border: "border-blue-500/30", fill: "#3b82f6" },
  { bg: "bg-teal-500", text: "text-teal-400", border: "border-teal-500/30", fill: "#14b8a6" },
  { bg: "bg-indigo-500", text: "text-indigo-400", border: "border-indigo-500/30", fill: "#6366f1" },
];

export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0 || !Number.isFinite(bytes)) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB", "PB", "EB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const unitIndex = Math.min(Math.max(0, i), sizes.length - 1);
  const formattedVal = bytes / Math.pow(k, unitIndex);
  const valString =
    formattedVal % 1 === 0
      ? formattedVal.toString()
      : parseFloat(formattedVal.toFixed(1)).toString();
  return `${valString} ${sizes[unitIndex]}`;
}

export function safePercent(bytes: number, total: number): number {
  if (
    !total ||
    total <= 0 ||
    !bytes ||
    bytes <= 0 ||
    !Number.isFinite(total) ||
    !Number.isFinite(bytes)
  ) {
    return 0;
  }
  const calculated = (bytes / total) * 100;
  if (!Number.isFinite(calculated)) {
    return 0;
  }
  return Math.max(0, Math.min(100, calculated));
}

export function PartitionDiskStorageUsageBar({
  partitions = [],
  totalSizeBytes: propTotalSizeBytes,
  totalSizePretty: propTotalSizePretty,
  onFilterByParent,
  onFilterByStatus,
}: PartitionDiskStorageUsageBarProps) {
  const [viewMode, setViewMode] = useState<"parent" | "tier">("parent");
  const [hoveredSegment, setHoveredSegment] = useState<string | null>(null);

  const totalBytes = useMemo(() => {
    if (typeof propTotalSizeBytes === "number" && Number.isFinite(propTotalSizeBytes)) {
      return Math.max(0, propTotalSizeBytes);
    }
    const computed = (partitions || []).reduce(
      (acc, p) =>
        acc +
        (p?.tableSizeBytes && p.tableSizeBytes > 0 && Number.isFinite(p.tableSizeBytes)
          ? p.tableSizeBytes
          : 0),
      0,
    );
    return Math.max(0, computed);
  }, [partitions, propTotalSizeBytes]);

  const totalFormatted = propTotalSizePretty || formatBytes(totalBytes);

  // Parent table breakdown
  const parentBreakdown = useMemo(() => {
    const map = new Map<string, { bytes: number; count: number; rows: number }>();
    (partitions || []).forEach((p) => {
      if (!p) return;
      const parentTable = p.parentTable || "unknown";
      const current = map.get(parentTable) || { bytes: 0, count: 0, rows: 0 };
      map.set(parentTable, {
        bytes:
          current.bytes +
          (p.tableSizeBytes && p.tableSizeBytes > 0 && Number.isFinite(p.tableSizeBytes)
            ? p.tableSizeBytes
            : 0),
        count: current.count + 1,
        rows:
          current.rows +
          (p.rowCount && p.rowCount > 0 && Number.isFinite(p.rowCount) ? p.rowCount : 0),
      });
    });

    const list = Array.from(map.entries()).map(([parentTable, data], idx) => {
      const percent = safePercent(data.bytes, totalBytes);
      const palette = TABLE_PALETTE[idx % TABLE_PALETTE.length];
      return {
        key: parentTable,
        label: parentTable,
        bytes: data.bytes,
        count: data.count,
        rows: data.rows,
        percent,
        palette,
      };
    });

    return list.sort((a, b) => b.bytes - a.bytes);
  }, [partitions, totalBytes]);

  // Status / Tier breakdown
  const tierBreakdown = useMemo(() => {
    let activeBytes = 0;
    let activeCount = 0;
    let archivedBytes = 0;
    let archivedCount = 0;
    let expiredBytes = 0;
    let expiredCount = 0;

    (partitions || []).forEach((p) => {
      if (!p) return;
      const bytes =
        p.tableSizeBytes && p.tableSizeBytes > 0 && Number.isFinite(p.tableSizeBytes)
          ? p.tableSizeBytes
          : 0;
      if (p.isArchived) {
        archivedBytes += bytes;
        archivedCount += 1;
      } else if (p.isExpired) {
        expiredBytes += bytes;
        expiredCount += 1;
      } else {
        activeBytes += bytes;
        activeCount += 1;
      }
    });

    return [
      {
        key: "ACTIVE",
        label: "Active (Attached)",
        bytes: activeBytes,
        count: activeCount,
        percent: safePercent(activeBytes, totalBytes),
        palette: {
          bg: "bg-emerald-500",
          text: "text-emerald-400",
          border: "border-emerald-500/30",
          fill: "#10b981",
        },
      },
      {
        key: "EXPIRED",
        label: "Expired (>12 mo)",
        bytes: expiredBytes,
        count: expiredCount,
        percent: safePercent(expiredBytes, totalBytes),
        palette: {
          bg: "bg-amber-500",
          text: "text-amber-400",
          border: "border-amber-500/30",
          fill: "#f59e0b",
        },
      },
      {
        key: "ARCHIVED",
        label: "Archived (Cold)",
        bytes: archivedBytes,
        count: archivedCount,
        percent: safePercent(archivedBytes, totalBytes),
        palette: {
          bg: "bg-zinc-600",
          text: "text-zinc-400",
          border: "border-zinc-500/30",
          fill: "#71717a",
        },
      },
    ].filter((tier) => tier.count > 0 || tier.bytes > 0);
  }, [partitions, totalBytes]);

  const activeSegments = viewMode === "parent" ? parentBreakdown : tierBreakdown;

  // Cold threshold warnings
  const heavyPartitionsCount = useMemo(() => {
    return (partitions || []).filter(
      (p) =>
        Boolean(p) &&
        (p.isNearColdStorage ||
          (p.tableSizeBytes && p.tableSizeBytes >= 100 * 1024 * 1024)),
    ).length;
  }, [partitions]);

  if (!partitions || partitions.length === 0) {
    return null;
  }

  const isZeroCapacity = totalBytes <= 0;

  return (
    <div
      role="region"
      aria-label="Partition disk storage usage breakdown"
      data-testid="partition-storage-usage-bar"
      className="mb-6 rounded-2xl border border-white/10 bg-white/[0.02] p-4 sm:p-5"
    >
      {/* Usage Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <HardDrive className="h-4 w-4 text-violet-400" />
          <h3 className="text-sm font-semibold text-zinc-100">
            Partition Disk Storage Usage
          </h3>
          <span className="text-xs text-zinc-400">
            ({isZeroCapacity ? "0 B (Empty / Uncalculated)" : `${totalFormatted} across ${partitions.length} partitions`})
          </span>
          {isZeroCapacity && (
            <span
              data-testid="storage-zero-capacity-badge"
              className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-zinc-800 text-zinc-400 border border-zinc-700"
            >
              No storage data recorded
            </span>
          )}
        </div>

        {/* View Toggle */}
        <div className="flex items-center gap-1.5 self-start sm:self-auto bg-black/30 p-1 rounded-xl border border-white/5 text-xs">
          <button
            type="button"
            onClick={() => setViewMode("parent")}
            className={`px-2.5 py-1 rounded-lg font-medium transition-colors ${
              viewMode === "parent"
                ? "bg-violet-600 text-white shadow-sm"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            By Table
          </button>
          <button
            type="button"
            onClick={() => setViewMode("tier")}
            className={`px-2.5 py-1 rounded-lg font-medium transition-colors ${
              viewMode === "tier"
                ? "bg-violet-600 text-white shadow-sm"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            By Tier
          </button>
        </div>
      </div>

      {/* Primary Stacked Progress Bar */}
      <div className="relative mb-3">
        <div
          className="flex h-4 w-full overflow-hidden rounded-full bg-zinc-900 border border-white/10 p-0.5"
          role="progressbar"
          aria-valuenow={isZeroCapacity ? 0 : 100}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Total partition storage: ${totalFormatted}`}
        >
          {isZeroCapacity ? (
            <div
              data-testid="storage-empty-fill"
              style={{ width: "0%" }}
              className="h-full bg-zinc-800"
              aria-label="0% storage capacity"
            />
          ) : (
            activeSegments.map((seg) => {
              if (seg.percent <= 0) return null;
              const isHovered = hoveredSegment === seg.key;
              const clampedPercent = Math.max(0, Math.min(100, seg.percent));
              const handleFilter = () => {
                if (viewMode === "parent") {
                  onFilterByParent?.(seg.key);
                } else {
                  onFilterByStatus?.(seg.key);
                }
              };
              return (
                <button
                  type="button"
                  key={seg.key}
                  data-testid={`progress-segment-${seg.key}`}
                  style={{ width: `${clampedPercent}%` }}
                  onMouseEnter={() => setHoveredSegment(seg.key)}
                  onMouseLeave={() => setHoveredSegment(null)}
                  onClick={handleFilter}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      handleFilter();
                    }
                  }}
                  className={`h-full transition-all focus:outline-none focus:ring-1 focus:ring-white ${
                    seg.palette.bg
                  } ${isHovered ? "brightness-125 scale-y-110 z-10" : "opacity-90 hover:opacity-100"}`}
                  title={`${seg.label}: ${formatBytes(seg.bytes)} (${clampedPercent.toFixed(1)}%) - Click to filter`}
                  aria-label={`${seg.label}: ${formatBytes(seg.bytes)} (${clampedPercent.toFixed(1)}%)`}
                />
              );
            })
          )}
        </div>
      </div>

      {/* Interactive Legend & Metric Grid */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-1">
        {isZeroCapacity ? (
          <p className="text-xs text-zinc-500 italic">
            Total disk storage capacity is 0 B or pending initialization.
          </p>
        ) : (
          activeSegments.map((seg) => {
            const isHovered = hoveredSegment === seg.key;
            const clampedPercent = Math.max(0, Math.min(100, seg.percent));
            const handleFilter = () => {
              if (viewMode === "parent") {
                onFilterByParent?.(seg.key);
              } else {
                onFilterByStatus?.(seg.key);
              }
            };
            return (
              <button
                type="button"
                key={seg.key}
                data-testid={`legend-item-${seg.key}`}
                onMouseEnter={() => setHoveredSegment(seg.key)}
                onMouseLeave={() => setHoveredSegment(null)}
                onClick={handleFilter}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    handleFilter();
                  }
                }}
                className={`flex items-center gap-1.5 text-xs rounded-lg px-2 py-1 transition-colors text-left ${
                  isHovered
                    ? "bg-white/10 text-white"
                    : "text-zinc-300 hover:bg-white/[0.04]"
                }`}
                title={`Click to filter by ${seg.label}`}
              >
                <span
                  className={`h-2.5 w-2.5 rounded-sm shrink-0 ${seg.palette.bg}`}
                />
                <span className="font-medium text-zinc-200">{seg.label}:</span>
                <span className="font-mono text-zinc-400">
                  {formatBytes(seg.bytes)}
                </span>
                <span className="text-[11px] text-zinc-500 font-mono">
                  ({clampedPercent.toFixed(1)}%)
                </span>
              </button>
            );
          })
        )}

        {heavyPartitionsCount > 0 && (
          <div className="ml-auto flex items-center gap-1 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2.5 py-0.5 rounded-full">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span>
              {heavyPartitionsCount} heavy partition(s) &gt;100 MB
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

export default PartitionDiskStorageUsageBar;

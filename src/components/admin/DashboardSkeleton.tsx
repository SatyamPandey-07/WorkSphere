import React from "react";
import { Skeleton } from "@/components/ui/skeleton";

export interface DashboardSkeletonProps {
  /** Optional custom CSS classes for the container */
  className?: string;
  /** Optional data-testid override for the root element */
  testId?: string;
  /** Number of stat metric cards to render (default: 4) */
  cardCount?: number;
  /** Number of large chart sections to render (default: 2) */
  chartCount?: number;
  /** Whether to render top-right action button placeholders (default: true) */
  showActions?: boolean;
}

export function DashboardSkeleton({
  className = "",
  testId = "admin-dashboard-skeleton",
  cardCount = 4,
  chartCount = 2,
  showActions = true,
}: DashboardSkeletonProps = {}) {
  const safeCardCount = Math.max(0, Math.min(cardCount, 12));
  const safeChartCount = Math.max(0, Math.min(chartCount, 6));

  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading admin dashboard"
      data-testid={testId}
      className={`min-h-screen bg-zinc-950 text-zinc-100 p-4 md:p-8 space-y-6 ${className}`.trim()}
    >
      <div
        className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"
        data-testid="admin-skeleton-header"
      >
        <div className="space-y-2" data-testid="admin-skeleton-title">
          <Skeleton className="h-8 w-64 bg-zinc-800" />
          <Skeleton className="h-4 w-96 bg-zinc-800" />
        </div>
        {showActions && (
          <div className="flex gap-2" data-testid="admin-skeleton-actions">
            <Skeleton className="h-10 w-28 rounded-lg bg-zinc-800" />
            <Skeleton className="h-10 w-28 rounded-lg bg-zinc-800" />
          </div>
        )}
      </div>

      {safeCardCount > 0 && (
        <div
          className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
          data-testid="admin-skeleton-cards"
        >
          {Array.from({ length: safeCardCount }).map((_, i) => (
            <div
              key={i}
              className="p-4 rounded-xl border border-zinc-800 bg-zinc-900/50 space-y-3"
              data-testid="admin-skeleton-card"
            >
              <Skeleton className="h-4 w-24 bg-zinc-800" />
              <Skeleton className="h-8 w-32 bg-zinc-800" />
              <Skeleton className="h-3 w-40 bg-zinc-800" />
            </div>
          ))}
        </div>
      )}

      {safeChartCount > 0 && (
        <div
          className="grid grid-cols-1 gap-6 lg:grid-cols-2"
          data-testid="admin-skeleton-charts"
        >
          {Array.from({ length: safeChartCount }).map((_, i) => (
            <div
              key={i}
              className="p-6 rounded-xl border border-zinc-800 bg-zinc-900/50 space-y-4"
              data-testid="admin-skeleton-chart"
            >
              <Skeleton className="h-6 w-48 bg-zinc-800" />
              <Skeleton className="h-64 w-full bg-zinc-800 rounded-lg" />
            </div>
          ))}
        </div>
      )}

      <div
        className="p-6 rounded-xl border border-zinc-800 bg-zinc-900/50 space-y-4"
        data-testid="admin-skeleton-table"
      >
        <Skeleton className="h-6 w-48 bg-zinc-800" />
        <Skeleton className="h-48 w-full bg-zinc-800 rounded-lg" />
      </div>
    </div>
  );
}

export default DashboardSkeleton;

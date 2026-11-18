"use client";

import React, { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { useStorageQuota } from "@/hooks/useStorageQuota";
import { StorageStatsDrawer } from "@/components/offline/StorageStatsDrawer";

export interface StorageUsageWarningBadgeProps {
  className?: string;
  "data-testid"?: string;
  onClick?: () => void;
  /** Force show for testing/story purposes */
  forceShow?: boolean;
}

export function StorageUsageWarningBadge({
  className = "",
  "data-testid": testId = "storage-usage-warning-badge",
  onClick,
  forceShow = false,
}: StorageUsageWarningBadgeProps) {
  const {
    usageMB,
    quotaMB,
    remainingMB,
    usagePercentage,
    isOverWarningThreshold,
  } = useStorageQuota();

  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  const shouldDisplay = forceShow || isOverWarningThreshold;

  if (!shouldDisplay) {
    return null;
  }

  const roundedUsage = Math.round(usageMB);
  const roundedQuota = Math.round(quotaMB);
  const roundedRemaining = Math.max(0, Math.round(remainingMB));
  const roundedPercentage = Math.round(usagePercentage * 10) / 10;

  const tooltipText = `Storage usage: ${roundedUsage} MB / ${roundedQuota} MB (${roundedPercentage}%)\nRemaining: ${roundedRemaining} MB`;
  const accessibleLabel = `Storage quota warning: ${roundedPercentage}% used (${roundedUsage} MB of ${roundedQuota} MB, ${roundedRemaining} MB remaining). Click to manage and clean up offline cache.`;

  const handleClick = () => {
    setIsDrawerOpen(true);
    onClick?.();
  };

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        data-testid={testId}
        aria-label={accessibleLabel}
        title={tooltipText}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-500/20 text-amber-600 dark:text-amber-300 border border-amber-500/40 hover:bg-amber-500/30 transition-all cursor-pointer shadow-sm focus:outline-none focus:ring-2 focus:ring-amber-500/50 ${className}`.trim()}
      >
        <AlertTriangle
          data-testid="storage-usage-warning-badge-icon"
          className="w-3.5 h-3.5 text-amber-500 dark:text-amber-400 shrink-0"
        />
        <span
          className="hidden sm:inline"
          data-testid="storage-usage-warning-badge-text"
        >
          Storage ({roundedPercentage}%)
        </span>
        <span
          className="sm:hidden"
          data-testid="storage-usage-warning-badge-text-mobile"
        >
          {roundedPercentage}%
        </span>
      </button>

      <StorageStatsDrawer
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        initialFocusSection="cleanup"
      />
    </>
  );
}

export default StorageUsageWarningBadge;

"use client";

import React, { useEffect, useState, useCallback } from "react";
import { AlertTriangle, Trash2, X } from "lucide-react";
import {
  STORAGE_QUOTA_WARNING_EVENT,
  StorageQuotaWarningDetail,
  clearStaleCaches,
} from "@/lib/cache/storageQuota";
import { useToast } from "@/components/ui/Toast";

/**
 * StorageQuotaWarningBanner:
 * Listens for `worksphere:storage-quota-warning` events and displays
 * a non-intrusive notification banner offering a "Clear Stale Caches" action.
 */
export function StorageQuotaWarningBanner() {
  const [visible, setVisible] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [usagePercentage, setUsagePercentage] = useState<number | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleQuotaWarning = (event: Event) => {
      const customEvent = event as CustomEvent<StorageQuotaWarningDetail>;
      console.warn(
        "[StorageQuotaBanner] Storage quota warning triggered by:",
        customEvent.detail?.source,
      );
      if (typeof customEvent.detail?.usagePercentage === "number") {
        setUsagePercentage(customEvent.detail.usagePercentage);
      }
      setVisible(true);
    };

    window.addEventListener(STORAGE_QUOTA_WARNING_EVENT, handleQuotaWarning);
    return () => {
      window.removeEventListener(
        STORAGE_QUOTA_WARNING_EVENT,
        handleQuotaWarning,
      );
    };
  }, []);

  const handleClearCaches = useCallback(async () => {
    setIsClearing(true);
    try {
      const { cleared } = await clearStaleCaches();
      toast(
        `Cleared cached storage (${cleared.length} cache stores cleaned)`,
        "success",
      );
      setVisible(false);
    } catch {
      toast(
        "Failed to clear some caches. Please check browser settings.",
        "error",
      );
    } finally {
      setIsClearing(false);
    }
  }, [toast]);

  if (!visible) return null;

  return (
    <aside
      role="alert"
      aria-live="polite"
      data-testid="storage-quota-warning-banner"
      className="fixed bottom-4 right-4 z-50 max-w-md w-[calc(100vw-2rem)] p-4 rounded-xl border border-amber-500/30 bg-amber-50/95 dark:bg-amber-950/90 text-amber-900 dark:text-amber-100 shadow-xl backdrop-blur-md transition-all duration-300"
    >
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-lg bg-amber-500/20 text-amber-600 dark:text-amber-400 shrink-0">
          <AlertTriangle className="w-5 h-5" />
        </div>
        <div className="flex-1 text-sm">
          <p className="font-semibold text-amber-950 dark:text-amber-50 flex items-center gap-2">
            <span>Storage Space Almost Full</span>
            {usagePercentage !== null && (
              <span
                data-testid="storage-quota-percent-badge"
                className="text-[11px] font-bold px-1.5 py-0.5 rounded bg-amber-200/80 dark:bg-amber-900/80 text-amber-900 dark:text-amber-100"
              >
                {usagePercentage}% used
              </span>
            )}
          </p>
          <p className="mt-1 text-xs text-amber-800 dark:text-amber-200/90 leading-relaxed">
            Your browser storage quota is nearly exhausted. Offline caches and
            proof generation may be degraded.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={handleClearCaches}
              disabled={isClearing}
              data-testid="clear-stale-caches-btn"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-600 hover:bg-amber-700 text-white shadow-sm transition disabled:opacity-50"
            >
              <Trash2 className="w-3.5 h-3.5" />
              {isClearing ? "Clearing..." : "Clear Stale Caches"}
            </button>
            <button
              onClick={() => setVisible(false)}
              data-testid="dismiss-quota-banner"
              className="px-2.5 py-1.5 rounded-lg text-xs text-amber-800 dark:text-amber-200 hover:bg-amber-200/40 dark:hover:bg-amber-900/50 transition"
            >
              Dismiss
            </button>
          </div>
        </div>
        <button
          onClick={() => setVisible(false)}
          data-testid="close-quota-banner-btn"
          aria-label="Close notification"
          className="text-amber-700 dark:text-amber-300 hover:text-amber-900 dark:hover:text-amber-100 p-1"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </aside>
  );
}

export default StorageQuotaWarningBanner;

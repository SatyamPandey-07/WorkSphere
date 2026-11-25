"use client";

import { CloudUpload, RefreshCw } from "lucide-react";
import { useOfflineSyncStatus } from "@/hooks/useOfflineSyncStatus";

/**
 * Compact navigation badge for pending IndexedDB changes.
 * It stays visible while work is queued and switches to blue while syncing.
 */
export function OfflineSyncStatusBadge() {
  const { isOffline, isSyncing, pendingCount } = useOfflineSyncStatus();

  if (pendingCount <= 0) return null;

  const syncing = isSyncing && !isOffline;
  const statusLabel = syncing
    ? `Syncing ${pendingCount} pending changes`
    : isOffline
      ? `${pendingCount} changes waiting for connection`
      : `${pendingCount} pending changes`;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={statusLabel}
      title={statusLabel}
      data-testid="offline-sync-status-badge"
      data-syncing={syncing ? "true" : "false"}
      className={[
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors",
        syncing
          ? "border-blue-300 bg-blue-50 text-blue-800 dark:border-blue-800 dark:bg-blue-950/60 dark:text-blue-200"
          : isOffline
            ? "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-200"
            : "border-zinc-300 bg-zinc-50 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200",
      ].join(" ")}
    >
      {syncing ? (
        <RefreshCw className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden="true" />
      ) : (
        <CloudUpload className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      )}
      <span>
        {syncing ? "Syncing" : "Pending"} {pendingCount}
      </span>
    </div>
  );
}

export default OfflineSyncStatusBadge;

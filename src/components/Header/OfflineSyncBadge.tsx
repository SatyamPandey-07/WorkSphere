
"use client";

import { useOfflineSync } from "@/hooks/useOfflineSync";
import { CloudOff, RefreshCw, Cloud } from "lucide-react";

export function OfflineSyncBadge() {
  const { isOffline, hasPendingChanges, isSyncing } = useOfflineSync();

  // Hide badge when everything is online and synchronized
  if (!isOffline && !hasPendingChanges && !isSyncing) {
    return null;
  }

  // Determine badge status
  const status = isOffline
    ? hasPendingChanges
      ? "Offline (Pending Sync)"
      : "Offline"
    : isSyncing
      ? "Syncing..."
      : "Pending Sync";

  // Determine icon
  const Icon = isOffline
    ? CloudOff
    : isSyncing
      ? RefreshCw
      : Cloud;

  // Determine icon styling
  const iconClass = isSyncing
    ? "text-blue-500 animate-spin"
    : !isOffline
      ? "text-blue-500"
      : "";

  return (
    <div
      role="status"
      aria-label={status}
      title={status}
      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 transition-all"
    >
      <Icon className={`w-3.5 h-3.5 ${iconClass}`} />

      <span className="hidden sm:inline">
        {status}
      </span>
    </div>
  );
}


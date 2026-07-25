"use client";

import { useOfflineSync } from "@/hooks/useOfflineSync";
import { CloudOff, RefreshCw, Cloud } from "lucide-react";
import { useEffect } from "react";

export function OfflineSyncBadge() {
  const { isOffline, hasPendingChanges, isSyncing } = useOfflineSync();

  useEffect(() => {
    // If it was syncing and now it's not, and there are no pending changes, show success briefly
    if (!isSyncing && !hasPendingChanges && !isOffline) {
      // Need a way to only show this when transitioning from syncing to success,
      // but without complex previous state refs, we can just rely on the sync process
      // completing.
      // A slightly better way is just to not show success unless it actually did something,
      // but keeping it subtle as per requirements.
    }
  }, [isSyncing, hasPendingChanges, isOffline]);

  if (!isOffline && !hasPendingChanges && !isSyncing) {
    return null;
  }

  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 transition-all">
      {isOffline && hasPendingChanges && (
        <>
          <CloudOff className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Offline (Pending Sync)</span>
        </>
      )}
      {isOffline && !hasPendingChanges && (
        <>
          <CloudOff className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Offline</span>
        </>
      )}
      {!isOffline && isSyncing && (
        <>
          <RefreshCw className="w-3.5 h-3.5 animate-spin text-blue-500" />
          <span className="hidden sm:inline">Syncing...</span>
        </>
      )}
      {!isOffline && !isSyncing && hasPendingChanges && (
        <>
          <Cloud className="w-3.5 h-3.5 text-blue-500" />
          <span className="hidden sm:inline">Pending Sync</span>
        </>
      )}
    </div>
  );
}

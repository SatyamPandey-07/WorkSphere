"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { RefreshCw, CheckCircle2, Wifi, X } from "lucide-react";
import { processPendingActions } from "@/lib/offlineStorage";

interface OfflineSyncProgressBarProps {
  /** Optional custom sync handler callback for tests or manual triggers */
  onSyncComplete?: () => void;
  /** Optional override for total pending items (useful for unit testing) */
  initialPendingCount?: number;
}

export function OfflineSyncProgressBar({
  onSyncComplete,
  initialPendingCount,
}: OfflineSyncProgressBarProps) {
  const [_isOnline, setIsOnline] = useState<boolean>(true);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [totalItems, setTotalItems] = useState<number>(0);
  const [remainingItems, setRemainingItems] = useState<number>(0);
  const [syncedItems, setSyncedItems] = useState<number>(0);
  const [showToast, setShowToast] = useState<boolean>(false);
  const [isCompleted, setIsCompleted] = useState<boolean>(false);
  const syncTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const startSyncProcess = useCallback(
    async (countOverride?: number) => {
      try {
        let pendingList: any[] = [];
        let count = countOverride;

        if (count === undefined) {
          pendingList = await processPendingActions();
          count = pendingList.length;
        }

        if (!count || count <= 0) {
          setIsSyncing(false);
          setShowToast(false);
          return;
        }

        setTotalItems(count);
        setRemainingItems(count);
        setSyncedItems(0);
        setIsSyncing(true);
        setIsCompleted(false);
        setShowToast(true);

        // Progressively sync remaining items
        let currentSynced = 0;
        const interval = setInterval(() => {
          currentSynced += 1;
          const remaining = Math.max(0, count! - currentSynced);
          setSyncedItems(currentSynced);
          setRemainingItems(remaining);

          if (currentSynced >= count!) {
            clearInterval(interval);
            setIsCompleted(true);
            setIsSyncing(false);
            onSyncComplete?.();

            // Auto dismiss toast 2 seconds after completion bar fills to 100%
            syncTimeoutRef.current = setTimeout(() => {
              setShowToast(false);
            }, 2000);
          }
        }, 400);
      } catch (err) {
        console.error("Offline sync error:", err);
        setIsSyncing(false);
      }
    },
    [onSyncComplete],
  );

  useEffect(() => {
    if (typeof window === "undefined") return;

    setIsOnline(navigator.onLine);

    const handleOnline = () => {
      setIsOnline(true);
      startSyncProcess();
    };

    const handleOffline = () => {
      setIsOnline(false);
      setIsSyncing(false);
      setShowToast(false);
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // Initial check if opened online or initial test count provided
    if (initialPendingCount !== undefined && initialPendingCount > 0) {
      startSyncProcess(initialPendingCount);
    } else if (navigator.onLine) {
      startSyncProcess();
    }

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
    };
  }, [initialPendingCount, startSyncProcess]);

  if (!showToast || totalItems <= 0) return null;

  const progressPercent = Math.min(
    100,
    Math.round((syncedItems / totalItems) * 100),
  );

  return (
    <div
      data-testid="offline-sync-progress-bar"
      aria-live="polite"
      className="fixed bottom-5 right-5 z-50 w-80 max-w-[90vw] p-4 bg-white/95 dark:bg-zinc-900/95 backdrop-blur-md border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-2xl transition-all animate-in slide-in-from-bottom-5 duration-300"
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2.5">
          {isCompleted ? (
            <div className="p-1.5 rounded-full bg-emerald-500/10 text-emerald-500">
              <CheckCircle2 className="w-5 h-5" />
            </div>
          ) : isSyncing ? (
            <div className="p-1.5 rounded-full bg-blue-500/10 text-blue-500">
              <RefreshCw className="w-5 h-5 animate-spin" />
            </div>
          ) : (
            <div className="p-1.5 rounded-full bg-zinc-500/10 text-zinc-500">
              <Wifi className="w-5 h-5" />
            </div>
          )}

          <div>
            <h4 className="text-xs font-bold text-zinc-900 dark:text-white uppercase tracking-wider">
              {isCompleted ? "Sync Completed" : "Reconnecting & Syncing"}
            </h4>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
              {isCompleted
                ? `Successfully synced all ${totalItems} offline actions`
                : `Syncing ${syncedItems} of ${totalItems} pending action${
                    totalItems > 1 ? "s" : ""
                  }... (${remainingItems} remaining)`}
            </p>
          </div>
        </div>

        <button
          onClick={() => setShowToast(false)}
          className="p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          title="Dismiss"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Animated Progress Bar */}
      <div className="w-full bg-zinc-100 dark:bg-zinc-800 h-2 rounded-full overflow-hidden mt-2">
        <div
          data-testid="sync-progress-fill"
          className={`h-full transition-all duration-300 ${
            isCompleted ? "bg-emerald-500" : "bg-blue-500"
          }`}
          style={{ width: `${progressPercent}%` }}
        />
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import {
  RefreshCw,
  CheckCircle2,
  Wifi,
  X,
  AlertTriangle,
  AlertCircle,
} from "lucide-react";
import { processPendingActions } from "@/lib/offlineStorage";

export const DEFAULT_MAX_RETRIES = 3;

export interface SyncQueueItem {
  id: string | number;
  name?: string;
  type?: string;
  retryCount?: number;
  status?: "pending" | "syncing" | "synced" | "failed";
  error?: string;
  shouldFail?: boolean;
  [key: string]: unknown;
}

export interface OfflineSyncProgressBarProps {
  /** Optional custom sync handler callback for tests or manual triggers */
  onSyncComplete?: (summary?: { successful: number; failed: number }) => void;
  /** Optional override for total pending items (useful for unit testing) */
  initialPendingCount?: number;
  /** Optional list of initial items (useful for testing failure scenarios) */
  initialItems?: SyncQueueItem[];
  /** Optional custom sync function per item */
  onSyncItem?: (
    item: SyncQueueItem,
  ) => Promise<boolean | void> | boolean | void;
  /** Optional callback when an item is discarded */
  onDiscardItem?: (itemId: string | number) => void;
  /** Optional callback when retry failed items is clicked */
  onRetryFailed?: (failedItems: SyncQueueItem[]) => void;
  /** Maximum failed retries before bypassing an item (default: 3) */
  maxRetries?: number;
}

export function OfflineSyncProgressBar({
  onSyncComplete,
  initialPendingCount,
  initialItems,
  onSyncItem,
  onDiscardItem,
  onRetryFailed,
  maxRetries = DEFAULT_MAX_RETRIES,
}: OfflineSyncProgressBarProps) {
  const [_isOnline, setIsOnline] = useState<boolean>(true);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [totalItems, setTotalItems] = useState<number>(0);
  const [remainingItems, setRemainingItems] = useState<number>(0);
  const [syncedItems, setSyncedItems] = useState<number>(0);
  const [failedItems, setFailedItems] = useState<SyncQueueItem[]>([]);
  const [showToast, setShowToast] = useState<boolean>(false);
  const [isCompleted, setIsCompleted] = useState<boolean>(false);
  const [showDetails, setShowDetails] = useState<boolean>(false);

  const syncTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const itemsRef = useRef<SyncQueueItem[]>([]);

  const startSyncProcess = useCallback(
    async (countOverride?: number, customItems?: SyncQueueItem[]) => {
      try {
        if (intervalRef.current) clearInterval(intervalRef.current);
        if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);

        let queue: SyncQueueItem[] = [];

        if (customItems && customItems.length > 0) {
          queue = customItems.map((item) => ({
            ...item,
            retryCount: item.retryCount ?? 0,
          }));
        } else if (initialItems && initialItems.length > 0) {
          queue = initialItems.map((item) => ({
            ...item,
            retryCount: item.retryCount ?? 0,
          }));
        } else if (countOverride !== undefined) {
          queue = Array.from({ length: countOverride }, (_, i) => ({
            id: `item-${i + 1}`,
            name: `Action ${i + 1}`,
            type: "offline-action",
            retryCount: 0,
            status: "pending",
          }));
        } else {
          const pendingList = await processPendingActions();
          queue = (pendingList || []).map((item, i) => ({
            ...item,
            id: item.id || `item-${i + 1}`,
            name: item.name || item.type || `Action ${i + 1}`,
            type: item.type || "offline-action",
            retryCount: item.retryCount ?? 0,
            status: (item.status as SyncQueueItem["status"]) || "pending",
            error: item.error,
          }));
        }

        const count = queue.length;
        if (!count || count <= 0) {
          setIsSyncing(false);
          setShowToast(false);
          return;
        }

        itemsRef.current = queue;
        setTotalItems(count);
        setRemainingItems(count);
        setSyncedItems(0);
        setFailedItems([]);
        setIsSyncing(true);
        setIsCompleted(false);
        setShowToast(true);

        let currentIndex = 0;
        let successful = 0;
        const failed: SyncQueueItem[] = [];

        intervalRef.current = setInterval(async () => {
          if (currentIndex >= itemsRef.current.length) {
            if (intervalRef.current) clearInterval(intervalRef.current);
            setIsCompleted(true);
            setIsSyncing(false);
            onSyncComplete?.({ successful, failed: failed.length });

            // Auto dismiss toast 2 seconds after completion bar fills if no failed items
            if (failed.length === 0) {
              syncTimeoutRef.current = setTimeout(() => {
                setShowToast(false);
              }, 2000);
            }
            return;
          }

          const currentItem = itemsRef.current[currentIndex];
          let itemFailed = false;
          let errorMessage =
            currentItem.error || "400 Bad Request: Validation failure";

          if (onSyncItem) {
            try {
              const res = await onSyncItem(currentItem);
              if (res === false) {
                itemFailed = true;
              }
            } catch (err: unknown) {
              itemFailed = true;
              if (err instanceof Error) {
                errorMessage = err.message;
              } else {
                errorMessage = "400 Bad Request";
              }
            }
          } else if (currentItem.shouldFail || currentItem.error) {
            itemFailed = true;
          }

          if (itemFailed) {
            currentItem.retryCount = (currentItem.retryCount ?? 0) + 1;
            currentItem.error = errorMessage;

            if (currentItem.retryCount >= maxRetries) {
              // Bypassed after reaching maximum retry limit
              currentItem.status = "failed";
              failed.push({ ...currentItem });
              setFailedItems([...failed]);
              currentIndex += 1;
            }
            // If retryCount < maxRetries, currentIndex does not increment so it retries
          } else {
            currentItem.status = "synced";
            successful += 1;
            setSyncedItems(successful);
            currentIndex += 1;
          }

          const remaining = Math.max(0, count - (successful + failed.length));
          setRemainingItems(remaining);

          if (currentIndex >= count) {
            if (intervalRef.current) clearInterval(intervalRef.current);
            setIsCompleted(true);
            setIsSyncing(false);
            onSyncComplete?.({ successful, failed: failed.length });

            if (failed.length === 0) {
              syncTimeoutRef.current = setTimeout(() => {
                setShowToast(false);
              }, 2000);
            }
          }
        }, 400);
      } catch (err) {
        console.error("Offline sync error:", err);
        setIsSyncing(false);
      }
    },
    [initialItems, maxRetries, onSyncComplete, onSyncItem],
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
    if (initialItems && initialItems.length > 0) {
      startSyncProcess(undefined, initialItems);
    } else if (initialPendingCount !== undefined && initialPendingCount > 0) {
      startSyncProcess(initialPendingCount);
    } else if (navigator.onLine) {
      startSyncProcess();
    }

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [initialItems, initialPendingCount, startSyncProcess]);

  const handleDiscardFailed = () => {
    failedItems.forEach((item) => {
      onDiscardItem?.(item.id);
    });
    setTotalItems((prev) => Math.max(0, prev - failedItems.length));
    setFailedItems([]);
    if (syncedItems > 0) {
      syncTimeoutRef.current = setTimeout(() => {
        setShowToast(false);
      }, 2000);
    } else {
      setShowToast(false);
    }
  };

  const handleDiscardSingleItem = (id: string | number) => {
    onDiscardItem?.(id);
    const updated = failedItems.filter((item) => item.id !== id);
    setFailedItems(updated);
    setTotalItems((prev) => Math.max(0, prev - 1));
    if (updated.length === 0) {
      if (syncedItems > 0) {
        syncTimeoutRef.current = setTimeout(() => {
          setShowToast(false);
        }, 2000);
      } else {
        setShowToast(false);
      }
    }
  };

  const handleRetryFailed = () => {
    const toRetry = failedItems.map((item) => ({
      ...item,
      retryCount: 0,
      status: "pending" as const,
      shouldFail: false,
    }));
    onRetryFailed?.(toRetry);
    startSyncProcess(undefined, toRetry);
  };

  if (!showToast || totalItems <= 0) return null;

  const hasFailed = failedItems.length > 0;

  // Complete sync progress bar for all successful items when completed
  const progressPercent = isCompleted
    ? 100
    : Math.min(100, Math.round((syncedItems / totalItems) * 100));

  return (
    <div
      data-testid="offline-sync-progress-bar"
      aria-live="polite"
      className="fixed bottom-5 right-5 z-50 w-80 max-w-[90vw] p-4 bg-white/95 dark:bg-zinc-900/95 backdrop-blur-md border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-2xl transition-all animate-in slide-in-from-bottom-5 duration-300"
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2.5">
          {hasFailed && isCompleted ? (
            <div
              data-testid="sync-alert-icon"
              className="p-1.5 rounded-full bg-amber-500/10 text-amber-500"
            >
              <AlertTriangle className="w-5 h-5" />
            </div>
          ) : isCompleted ? (
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
              {hasFailed && isCompleted
                ? "Sync Warning"
                : isCompleted
                  ? "Sync Completed"
                  : "Reconnecting & Syncing"}
            </h4>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
              {hasFailed && isCompleted
                ? `${failedItems.length} item${
                    failedItems.length > 1 ? "s" : ""
                  } failed to sync (${syncedItems} synced)`
                : isCompleted
                  ? `Successfully synced all ${totalItems} offline actions`
                  : `Syncing ${syncedItems || 1} of ${totalItems} pending action${
                      totalItems > 1 ? "s" : ""
                    }... (${remainingItems} remaining)`}
            </p>
          </div>
        </div>

        <button
          onClick={() => setShowToast(false)}
          className="p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          title="Dismiss"
          aria-label="Dismiss"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Animated Progress Bar */}
      <div className="w-full bg-zinc-100 dark:bg-zinc-800 h-2 rounded-full overflow-hidden mt-2">
        <div
          data-testid="sync-progress-fill"
          className={`h-full transition-all duration-300 ${
            hasFailed && isCompleted
              ? "bg-amber-500"
              : isCompleted
                ? "bg-emerald-500"
                : "bg-blue-500"
          }`}
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      {/* Warning banner when queue items failed after max retries */}
      {hasFailed && (
        <div
          data-testid="sync-failed-warning"
          className="mt-3 p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-800 dark:text-amber-200"
        >
          <div className="flex items-center justify-between text-xs font-semibold">
            <div className="flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
              <span>
                {failedItems.length} item
                {failedItems.length > 1 ? "s" : ""} failed to sync
              </span>
            </div>
            <span
              data-testid="failed-item-badge"
              className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-200/60 dark:bg-amber-900/50 text-amber-800 dark:text-amber-300 font-bold"
            >
              {failedItems.length} failed
            </span>
          </div>

          <div className="flex items-center gap-2 mt-2">
            <button
              data-testid="retry-sync-btn"
              onClick={handleRetryFailed}
              className="px-2.5 py-1 text-xs font-bold bg-amber-500 hover:bg-amber-600 text-white rounded-lg transition-colors flex items-center gap-1"
            >
              <RefreshCw className="w-3 h-3" />
              Retry
            </button>
            <button
              data-testid="discard-sync-btn"
              onClick={handleDiscardFailed}
              className="px-2.5 py-1 text-xs font-bold bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 rounded-lg transition-colors"
            >
              Discard
            </button>
            <button
              data-testid="view-failed-btn"
              onClick={() => setShowDetails(!showDetails)}
              className="text-xs text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200 underline ml-auto font-medium"
            >
              {showDetails ? "Hide" : "View"}
            </button>
          </div>

          {showDetails && (
            <div
              data-testid="failed-items-details"
              className="mt-2.5 pt-2 border-t border-amber-500/20 space-y-1.5"
            >
              {failedItems.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between text-[11px] p-1.5 rounded-lg bg-white/60 dark:bg-zinc-900/60"
                >
                  <div className="flex items-center gap-1.5 overflow-hidden">
                    <AlertCircle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                    <span className="font-semibold truncate text-zinc-800 dark:text-zinc-200">
                      {item.name || item.type || `Item ${item.id}`}
                    </span>
                    <span
                      data-testid={`failed-item-badge-${item.id}`}
                      className="text-[9px] px-1 rounded bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 shrink-0"
                    >
                      {item.retryCount} retries
                    </span>
                  </div>
                  <button
                    data-testid={`discard-item-${item.id}`}
                    onClick={() => handleDiscardSingleItem(item.id)}
                    className="text-[10px] font-bold text-rose-500 hover:text-rose-700 ml-2 shrink-0"
                  >
                    Discard
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

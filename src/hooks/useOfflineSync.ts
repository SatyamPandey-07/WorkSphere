import { useState, useEffect, useCallback } from "react";
import { getPendingFavorites, getTotalPendingMutationsCount } from "@/lib/offlineStorage";
import { globalSyncQueue, generateIdempotencyKey, SyncQueueItem } from "@/lib/offlineSyncQueue";

export interface UseOfflineSyncReturn {
  isOffline: boolean;
  hasPendingChanges: boolean;
  isSyncing: boolean;
  pendingCount: number;
  enqueueMutation: <T = unknown>(type: string, payload: T, options?: { maxRetries?: number; id?: string }) => SyncQueueItem<T>;
}

/**
 * Helper utility to enqueue an offline mutation with deterministic idempotency keys
 * to prevent duplicate queue entries in IndexedDB offline mutation store (#4378).
 */
export function enqueueOfflineMutation<T = unknown>(
  type: string,
  payload: T,
  options: { maxRetries?: number; id?: string } = {}
): SyncQueueItem<T> {
  const id = options.id || generateIdempotencyKey(type, payload);
  return globalSyncQueue.enqueue(type, payload, { ...options, id });
}

export function useOfflineSync(): UseOfflineSyncReturn {
  const [isOffline, setIsOffline] = useState(false);
  const [hasPendingChanges, setHasPendingChanges] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined") return;

    let isMounted = true;
    let syncTimeout: ReturnType<typeof setTimeout> | undefined;

    const checkPendingChanges = async () => {
      try {
        let count = 0;
        try {
          count = await getTotalPendingMutationsCount();
        } catch {
          const pending = await getPendingFavorites();
          count = pending.length;
        }

        if (isMounted) {
          setPendingCount(count);
          setHasPendingChanges(count > 0);
        }
      } catch (e) {
        console.error("Failed to check pending changes:", e);
      }
    };

    const updateOnlineStatus = () => {
      if (!isMounted) return;

      const offline = !navigator.onLine;
      setIsOffline(offline);

      if (!offline) {
        setIsSyncing(true);

        syncTimeout = setTimeout(async () => {
          await checkPendingChanges();

          if (isMounted) {
            setIsSyncing(false);
          }
        }, 3000);
      } else {
        checkPendingChanges();
      }
    };

    const handleTriggerSync = () => {
      checkPendingChanges();
    };

    updateOnlineStatus();
    checkPendingChanges();

    window.addEventListener("online", updateOnlineStatus);
    window.addEventListener("offline", updateOnlineStatus);
    window.addEventListener("trigger-sync", handleTriggerSync);

    return () => {
      isMounted = false;

      if (syncTimeout) {
        clearTimeout(syncTimeout);
      }

      window.removeEventListener("online", updateOnlineStatus);
      window.removeEventListener("offline", updateOnlineStatus);
      window.removeEventListener("trigger-sync", handleTriggerSync);
    };
  }, []);

  const enqueueMutation = useCallback(
    <T = unknown>(type: string, payload: T, options: { maxRetries?: number; id?: string } = {}) => {
      return enqueueOfflineMutation(type, payload, options);
    },
    []
  );

  return {
    isOffline,
    hasPendingChanges,
    isSyncing,
    pendingCount,
    enqueueMutation,
  };
}

import { useState, useEffect } from "react";
import { getPendingFavorites, getTotalPendingMutationsCount } from "@/lib/offlineStorage";

export interface UseOfflineSyncReturn {
  isOffline: boolean;
  hasPendingChanges: boolean;
  isSyncing: boolean;
  pendingCount: number;
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

  return {
    isOffline,
    hasPendingChanges,
    isSyncing,
    pendingCount,
  };
}

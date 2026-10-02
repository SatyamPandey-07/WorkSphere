import { useState, useEffect } from "react";
import { getPendingFavorites } from "@/lib/offlineStorage";

export function useOfflineSync() {
  const [isOffline, setIsOffline] = useState(false);
  const [hasPendingChanges, setHasPendingChanges] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    let isMounted = true;
    let syncTimeout: ReturnType<typeof setTimeout> | undefined;

    const checkPendingChanges = async () => {
      try {
        const pending = await getPendingFavorites();

        if (isMounted) {
          setHasPendingChanges(pending.length > 0);
        }
      } catch (e) {
        console.error("Failed to check pending favorites:", e);
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
  };
}

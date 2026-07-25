import { useState, useEffect } from "react";
import { getPendingFavorites } from "@/lib/offlineStorage";

export function useOfflineSync() {
  const [isOffline, setIsOffline] = useState(false);
  const [hasPendingChanges, setHasPendingChanges] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    // Track online/offline status
    const updateOnlineStatus = () => {
      setIsOffline(!navigator.onLine);
    };

    updateOnlineStatus();

    window.addEventListener("online", updateOnlineStatus);
    window.addEventListener("offline", updateOnlineStatus);

    // Track pending changes
    const checkPendingChanges = async () => {
      try {
        const pending = await getPendingFavorites();
        setHasPendingChanges(pending.length > 0);
      } catch (e) {
        console.error("Failed to check pending favorites:", e);
      }
    };

    checkPendingChanges();

    // Listen for custom trigger-sync events (fired when we queue offline favorites)
    window.addEventListener("trigger-sync", checkPendingChanges);

    // When we come back online, we might be syncing
    const handleOnline = async () => {
      setIsSyncing(true);

      // Wait for a little bit to allow background sync to process
      setTimeout(async () => {
        await checkPendingChanges();
        setIsSyncing(false);
      }, 3000);
    };

    window.addEventListener("online", handleOnline);

    return () => {
      window.removeEventListener("online", updateOnlineStatus);
      window.removeEventListener("offline", updateOnlineStatus);
      window.removeEventListener("trigger-sync", checkPendingChanges);
      window.removeEventListener("online", handleOnline);
    };
  }, []);

  return { isOffline, hasPendingChanges, isSyncing };
}

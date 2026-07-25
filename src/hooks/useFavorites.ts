import { useState, useEffect } from "react";
import { queuePendingFavorite } from "@/lib/offlineStorage";

export function useFavorites(venueId: string, initialIsFavorited: boolean) {
  const [isFavorited, setIsFavorited] = useState(initialIsFavorited);
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setIsOnline(navigator.onLine);

      const handleOnline = () => setIsOnline(true);
      const handleOffline = () => setIsOnline(false);

      window.addEventListener("online", handleOnline);
      window.addEventListener("offline", handleOffline);

      return () => {
        window.removeEventListener("online", handleOnline);
        window.removeEventListener("offline", handleOffline);
      };
    }
  }, []);

  const toggleFavorite = async () => {
    const nextState = !isFavorited;

    // 1. Optimistic Update: Change the layout heart state instantly
    setIsFavorited(nextState);

    const actionType = nextState ? "add" : "remove";

    if (isOnline) {
      try {
        const response = await fetch("/api/favorites", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ venueId, action: actionType }),
        });

        if (!response.ok) throw new Error("Network response failed");
      } catch {
        console.warn("Live fallback failed. Reverting to offline queue logic.");
        await queuePendingFavorite(venueId, actionType);
        window.dispatchEvent(new CustomEvent("trigger-sync"));
      }
    } else {
      // 2. Offline Fallback: Queue up operation for Background Sync processing
      await queuePendingFavorite(venueId, actionType);
      window.dispatchEvent(new CustomEvent("trigger-sync"));
    }
  };

  return { isFavorited, toggleFavorite, isOnline };
}

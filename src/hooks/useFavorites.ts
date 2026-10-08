import { useState, useEffect, useRef } from "react";
import { queueOfflineFavorite } from "@/lib/offlineStore";
export function useFavorites(venueId: string, initialIsFavorited: boolean) {
  const [isFavorited, setIsFavorited] = useState(initialIsFavorited);
  const [isOnline, setIsOnline] = useState(true);

  const latestStateRef = useRef(initialIsFavorited);
  const latestToggleRef = useRef(0);

  useEffect(() => {
    latestStateRef.current = isFavorited;
  }, [isFavorited]);

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
    const previousState = latestStateRef.current;
    const nextState = !previousState;
    const actionType = nextState ? "ADD" : "REMOVE";
    const toggleId = ++latestToggleRef.current;

    // Optimistic update
    latestStateRef.current = nextState;
    setIsFavorited(nextState);

    // Offline fallback
    if (!isOnline) {
      await queueOfflineFavorite(venueId, actionType);
      window.dispatchEvent(new CustomEvent("trigger-sync"));
      return;
    }

    try {
      const response = nextState
        ? await fetch("/api/favorites", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ venueId }),
          })
        : await fetch(
            `/api/favorites?venueId=${encodeURIComponent(venueId)}`,
            {
              method: "DELETE",
            },
          );

      if (!response.ok) {
        throw new Error("Network response failed");
      }
    } catch {
      // Ignore stale failures from older toggle requests.
      if (toggleId !== latestToggleRef.current) {
        return;
      }

      latestStateRef.current = previousState;
      setIsFavorited(previousState);

      console.warn("Live favorite update failed. Queuing operation.");
      await queueOfflineFavorite(venueId, actionType);
      window.dispatchEvent(new CustomEvent("trigger-sync"));
    }
  };

  return { isFavorited, toggleFavorite, isOnline };
}
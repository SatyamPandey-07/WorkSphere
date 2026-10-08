import { queuePendingFavorite, venuesRepository, type OfflineVenue } from "@/lib/offlineStorage";

const STORAGE_KEY = "worksphere:favorite_venues";
const BROADCAST_CHANNEL_NAME = "worksphere:favorite-changes";

export interface FavoriteChangeEvent {
  venueId: string;
  isFavorited: boolean;
  timestamp: number;
}

let broadcastChannel: BroadcastChannel | null = null;

function getBroadcastChannel(): BroadcastChannel | null {
  if (typeof window === "undefined" || !("BroadcastChannel" in window)) {
    return null;
  }
  if (!broadcastChannel) {
    try {
      broadcastChannel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
    } catch {
      broadcastChannel = null;
    }
  }
  return broadcastChannel;
}

/**
 * Retrieves the set of locally favorited / bookmarked venue IDs from localStorage.
 */
export function getLocalFavoriteIds(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Checks whether a venue is marked as favorited/bookmarked in local storage.
 */
export function isVenueFavoritedLocally(venueId: string): boolean {
  if (!venueId) return false;
  const ids = getLocalFavoriteIds();
  return ids.includes(venueId);
}

/**
 * Sets the favorite/bookmarked state for a venue in local storage and broadcasts changes.
 */
export function setVenueFavoritedLocally(
  venueId: string,
  isFavorited: boolean,
  venueData?: Partial<OfflineVenue>,
): void {
  if (typeof window === "undefined" || !venueId) return;

  try {
    const current = new Set(getLocalFavoriteIds());
    if (isFavorited) {
      current.add(venueId);
    } else {
      current.delete(venueId);
    }

    const updatedArray = Array.from(current);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedArray));

    // Also persist/update in IndexedDB offline repository
    if (venueData && venueData.id) {
      const offlineVenue: OfflineVenue = {
        id: venueId,
        name: venueData.name || "Workspace",
        latitude: venueData.latitude || 0,
        longitude: venueData.longitude || 0,
        category: venueData.category || "cafe",
        address: venueData.address || null,
        rating: venueData.rating || null,
        wifiQuality: venueData.wifiQuality || null,
        hasOutlets: Boolean(venueData.hasOutlets),
        noiseLevel: venueData.noiseLevel || null,
        imageUrl: venueData.imageUrl || null,
        isFavorite: isFavorited,
        isPinned: Boolean(venueData.isPinned),
        cachedAt: Date.now(),
        lastAccessedAt: Date.now(),
      };

      if (isFavorited) {
        venuesRepository.saveFavorite(offlineVenue).catch(() => {});
      } else {
        venuesRepository.removeFavorite(venueId).catch(() => {});
      }
    }

    // Broadcast across windows and components
    const eventPayload: FavoriteChangeEvent = {
      venueId,
      isFavorited,
      timestamp: Date.now(),
    };

    window.dispatchEvent(
      new CustomEvent("worksphere:favorite-change", { detail: eventPayload }),
    );

    const channel = getBroadcastChannel();
    channel?.postMessage(eventPayload);
  } catch (err) {
    console.warn("[favoriteStorage] Failed to save favorite locally:", err);
  }
}

const inFlightToggles = new Map<string, Promise<boolean>>();
const lastToggleTimestamps = new Map<string, number>();

/**
 * Toggles the favorite/bookmarked state for a venue with local persistence and server sync.
 * Protected against rapid double-clicks and concurrent in-flight toggling.
 */
export async function toggleVenueFavorite(
  venueId: string,
  venueData?: Partial<OfflineVenue>,
): Promise<boolean> {
  if (!venueId) return false;

  const now = Date.now();
  const lastTime = lastToggleTimestamps.get(venueId) || 0;

  // If an in-flight toggle is already running for this venue, return its existing promise
  if (inFlightToggles.has(venueId)) {
    return inFlightToggles.get(venueId)!;
  }

  // Guard against rapid duplicate invocation (< 300ms)
  if (now - lastTime < 300) {
    return isVenueFavoritedLocally(venueId);
  }

  lastToggleTimestamps.set(venueId, now);

  const togglePromise = (async () => {
    try {
      const currentlyFavorited = isVenueFavoritedLocally(venueId);
      const nextState = !currentlyFavorited;

      // 1. Instant local persistence
      setVenueFavoritedLocally(venueId, nextState, venueData);

      const actionType = nextState ? "add" : "remove";

      // 2. Server / Offline Sync
      if (typeof navigator !== "undefined" && navigator.onLine) {
        try {
          const response = await fetch("/api/favorites", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ venueId, action: actionType }),
          });

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }
        } catch {
          // Offline fallback: queue operation for background sync
          await queuePendingFavorite(venueId, actionType);
          if (typeof window !== "undefined") {
            window.dispatchEvent(new CustomEvent("trigger-sync"));
          }
        }
      } else {
        // Queue offline sync
        await queuePendingFavorite(venueId, actionType);
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("trigger-sync"));
        }
      }

      return nextState;
    } finally {
      inFlightToggles.delete(venueId);
    }
  })();

  inFlightToggles.set(venueId, togglePromise);
  return togglePromise;
}

/**
 * Subscribes to favorite changes across all components, tabs, and windows.
 */
export function subscribeToFavoriteChanges(
  callback: (event: FavoriteChangeEvent) => void,
): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  const handleCustomEvent = (e: Event) => {
    const customEvent = e as CustomEvent<FavoriteChangeEvent>;
    if (customEvent.detail) {
      callback(customEvent.detail);
    }
  };

  const channel = getBroadcastChannel();
  const handleChannelMessage = (e: MessageEvent<FavoriteChangeEvent>) => {
    if (e.data) {
      callback(e.data);
    }
  };

  window.addEventListener("worksphere:favorite-change", handleCustomEvent);
  channel?.addEventListener("message", handleChannelMessage);

  return () => {
    window.removeEventListener("worksphere:favorite-change", handleCustomEvent);
    channel?.removeEventListener("message", handleChannelMessage);
  };
}

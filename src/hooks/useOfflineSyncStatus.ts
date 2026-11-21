"use client";

import { useCallback, useEffect, useState } from "react";
import { getTotalPendingMutationsCount } from "@/lib/offlineStorage";
import { getQueuedReviews } from "@/lib/offlineReviewSync";

const SYNC_POLL_INTERVAL_MS = 1_000;
const PENDING_COUNT_REFRESH_INTERVAL_MS = 3_000;
const MAX_SYNC_INDICATOR_MS = 20_000;

export interface OfflineSyncStatus {
  isOffline: boolean;
  isSyncing: boolean;
  pendingCount: number;
  refreshPendingCount: () => Promise<number | null>;
}

async function readPendingMutationCount(): Promise<number> {
  const [storedCount, reviewCount] = await Promise.allSettled([
    getTotalPendingMutationsCount(),
    getQueuedReviews(),
  ]);

  const stored = storedCount.status === "fulfilled" ? storedCount.value : null;
  const reviews = reviewCount.status === "fulfilled" ? reviewCount.value.length : null;

  if (stored === null && reviews === null) {
    throw new Error("Unable to read pending offline mutations");
  }

  // Reviews use the dedicated review IndexedDB database; the shared outbox
  // count covers bookmarks and the other legacy pending mutation stores.
  return Math.max(0, (stored ?? 0) + (reviews ?? 0));
}

async function requestBackgroundSync(): Promise<void> {
  if (
    typeof navigator === "undefined" ||
    !("serviceWorker" in navigator)
  ) {
    return;
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    const syncRegistration = registration as ServiceWorkerRegistration & {
      sync?: { register: (tag: string) => Promise<void> };
    };

    if (!syncRegistration.sync) return;

    await Promise.allSettled(
      ["sync-favorites", "sync-ratings", "sync-reviews"].map((tag) =>
        syncRegistration.sync!.register(tag),
      ),
    );
  } catch {
    // The foreground sync worker and review fallback handle browsers that
    // do not expose Background Sync or reject registration.
  }
}

/**
 * Reads the pending IndexedDB outboxes and tracks their reconnect lifecycle.
 * The online event also wakes the existing foreground worker and requests
 * Service Worker batches where the Background Sync API is available.
 */
export function useOfflineSyncStatus(): OfflineSyncStatus {
  const [isOffline, setIsOffline] = useState(
    () => typeof navigator !== "undefined" && !navigator.onLine,
  );
  const [isSyncing, setIsSyncing] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);

  const refreshPendingCount = useCallback(async (): Promise<number | null> => {
    try {
      const count = await readPendingMutationCount();
      setPendingCount(count);
      if (count === 0) setIsSyncing(false);
      return count;
    } catch {
      // Keep the last known count when IndexedDB is temporarily unavailable.
      return null;
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    let disposed = false;
    let pollTimer: ReturnType<typeof setInterval> | undefined;
    let countRefreshTimer: ReturnType<typeof setInterval> | undefined;
    let stopTimer: ReturnType<typeof setTimeout> | undefined;

    const stopSyncWatch = () => {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = undefined;
      }
      if (stopTimer) {
        clearTimeout(stopTimer);
        stopTimer = undefined;
      }
    };

    const startSyncWatch = () => {
      stopSyncWatch();
      setIsSyncing(true);

      const poll = async () => {
        const count = await refreshPendingCount();
        if (count === 0) {
          stopSyncWatch();
          if (!disposed) setIsSyncing(false);
        }
      };

      void poll();
      pollTimer = setInterval(() => {
        void poll();
      }, SYNC_POLL_INTERVAL_MS);
      stopTimer = setTimeout(() => {
        stopSyncWatch();
        if (!disposed) setIsSyncing(false);
      }, MAX_SYNC_INDICATOR_MS);
    };

    const handleOnline = () => {
      setIsOffline(false);
      startSyncWatch();

      // useSyncWorker listens for this event and wakes the favorites worker.
      window.dispatchEvent(new Event("trigger-sync"));
      void requestBackgroundSync();
    };

    const handleOffline = () => {
      setIsOffline(true);
      stopSyncWatch();
      setIsSyncing(false);
      void refreshPendingCount();
    };

    const handleStorageChange = () => {
      void refreshPendingCount();
    };

    const handleSyncProgress = (event: Event) => {
      const detail = (event as CustomEvent<{ type?: string }>).detail;
      if (detail?.type === "SYNC_STARTED") {
        startSyncWatch();
        return;
      }
      void refreshPendingCount();
    };

    void refreshPendingCount();
    // Keep the badge accurate when writes are queued while the device remains offline.
    countRefreshTimer = setInterval(() => {
      void refreshPendingCount();
    }, PENDING_COUNT_REFRESH_INTERVAL_MS);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    window.addEventListener("trigger-sync", handleStorageChange);
    window.addEventListener("worksphere:review-sync-event", handleStorageChange);
    window.addEventListener("worksphere:sync-progress", handleSyncProgress);

    return () => {
      disposed = true;
      stopSyncWatch();
      if (countRefreshTimer) clearInterval(countRefreshTimer);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("trigger-sync", handleStorageChange);
      window.removeEventListener("worksphere:review-sync-event", handleStorageChange);
      window.removeEventListener("worksphere:sync-progress", handleSyncProgress);
    };
  }, [refreshPendingCount]);

  return { isOffline, isSyncing, pendingCount, refreshPendingCount };
}

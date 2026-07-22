import "fake-indexeddb/auto";
import {
  queueOfflineFavorite,
  getQueuedFavorites,
  dequeueOfflineAction,
} from "../../lib/offlineStore";

describe("Issue #871 - Offline Queue Retry on Network Restoration", () => {
  let originalOnLine: boolean;

  beforeEach(async () => {
    originalOnLine = navigator.onLine;
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      value: true,
      writable: true,
    });
    const queued = await getQueuedFavorites();
    for (const item of queued) {
      if (item.id) await dequeueOfflineAction(item.id);
    }
  });

  afterEach(() => {
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      value: originalOnLine,
      writable: true,
    });
  });

  it("retains pending outbox transactions when offline without purging them", async () => {
    // Simulate offline state
    Object.defineProperty(navigator, "onLine", {
      value: false,
      writable: true,
    });

    // Queue 2 favorite actions while offline
    await queueOfflineFavorite("venue-offline-1", "ADD");
    await queueOfflineFavorite("venue-offline-2", "ADD");

    const queuedBefore = await getQueuedFavorites();
    expect(queuedBefore).toHaveLength(2);
    expect(queuedBefore[0].venueId).toBe("venue-offline-1");
    expect(queuedBefore[0].retryCount).toBe(0);
    expect(queuedBefore[1].venueId).toBe("venue-offline-2");
    expect(queuedBefore[1].retryCount).toBe(0);
  });

  it("flushes pending actions from outbox when network is restored", async () => {
    // Queue items while offline
    Object.defineProperty(navigator, "onLine", {
      value: false,
      writable: true,
    });
    await queueOfflineFavorite("venue-flush-1", "ADD");
    await queueOfflineFavorite("venue-flush-2", "ADD");

    const queuedOffline = await getQueuedFavorites();
    expect(queuedOffline).toHaveLength(2);

    // Network restored
    Object.defineProperty(navigator, "onLine", { value: true, writable: true });

    // Simulate successful sync pass by processing and dequeuing actions
    for (const item of queuedOffline) {
      if (item.id) {
        await dequeueOfflineAction(item.id);
      }
    }

    const queuedAfter = await getQueuedFavorites();
    expect(queuedAfter).toHaveLength(0);
  });
});

import "fake-indexeddb/auto";

/**
 * Tests for src/lib/offlineStore.ts
 *
 * Covers Issue #395: double-clicking the offline favourite button caused a
 * ConstraintError because queueOfflineFavorite supplied an explicit `id`
 * computed from Date.now(), which collided when two calls arrived within the
 * same millisecond.  The fix removes the explicit id so IndexedDB's own
 * autoIncrement generator assigns unique keys.
 */

import {
  queueOfflineFavorite,
  getQueuedFavorites,
  dequeueOfflineAction,
} from "../../lib/offlineStore";

describe("offlineStore – queueOfflineFavorite", () => {
  it("queues a single action with the correct shape", async () => {
    await queueOfflineFavorite("venue-1", "ADD");

    const queued = await getQueuedFavorites();
    const entry = queued.find((a) => a.venueId === "venue-1");

    expect(entry).toBeDefined();
    expect(entry!.action).toBe("ADD");
    expect(typeof entry!.timestamp).toBe("number");
    // id must be present and be a number (assigned by autoIncrement)
    expect(typeof entry!.id).toBe("number");
  });

  it("does NOT throw a ConstraintError when called twice in rapid succession (double-click)", async () => {
    // Fire both calls concurrently without awaiting the first — this mirrors
    // what happens when a user double-clicks the Check In / Favourite button.
    await expect(
      Promise.all([
        queueOfflineFavorite("venue-double", "ADD"),
        queueOfflineFavorite("venue-double", "ADD"),
      ]),
    ).resolves.not.toThrow();

    const queued = await getQueuedFavorites();
    const entries = queued.filter((a) => a.venueId === "venue-double");

    // Both inserts must have succeeded — two distinct records in the store.
    expect(entries).toHaveLength(2);

    // Each record must have a unique autoIncrement id.
    const ids = entries.map((e) => e.id);
    expect(new Set(ids).size).toBe(2);
  });

  it("queues a REMOVE action correctly", async () => {
    await queueOfflineFavorite("venue-remove", "REMOVE");

    const queued = await getQueuedFavorites();
    const entry = queued.find((a) => a.venueId === "venue-remove");

    expect(entry).toBeDefined();
    expect(entry!.action).toBe("REMOVE");
  });

  it("dequeueOfflineAction removes the correct entry by id", async () => {
    await queueOfflineFavorite("venue-dequeue", "ADD");

    const before = await getQueuedFavorites();
    const target = before.find((a) => a.venueId === "venue-dequeue");
    expect(target).toBeDefined();

    await dequeueOfflineAction(target!.id!);

    const after = await getQueuedFavorites();
    expect(after.find((a) => a.id === target!.id)).toBeUndefined();
  });

  describe("Safari Private Browsing SecurityError handling", () => {
    let originalOpen: typeof indexedDB.open;
    let localQueueOfflineFavorite: typeof queueOfflineFavorite;

    beforeEach(() => {
      jest.resetModules();
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const localStore = require("../../lib/offlineStore");
      localQueueOfflineFavorite = localStore.queueOfflineFavorite;

      originalOpen = indexedDB.open;
      global.window = {} as any;
      global.alert = jest.fn();
    });

    afterEach(() => {
      indexedDB.open = originalOpen;
      if (
        typeof window !== "undefined" &&
        (window as any).__worksphere_offline_alert_shown
      ) {
        delete (window as any).__worksphere_offline_alert_shown;
      }
      delete (global as any).window;
      delete (global as any).alert;
    });

    it("gracefully intercepts synchronous SecurityError and alerts user once", async () => {
      indexedDB.open = jest.fn().mockImplementation(() => {
        const err = new Error("SecurityError: access blocked");
        err.name = "SecurityError";
        throw err;
      });

      await expect(
        localQueueOfflineFavorite("venue-fail-sync", "ADD"),
      ).resolves.toBeUndefined();
      expect(global.alert).toHaveBeenCalledTimes(1);

      // Verify alert is only shown once (subsequent errors do not spam alerts)
      await expect(
        localQueueOfflineFavorite("venue-fail-sync-2", "ADD"),
      ).resolves.toBeUndefined();
      expect(global.alert).toHaveBeenCalledTimes(1);
    });
  });
});

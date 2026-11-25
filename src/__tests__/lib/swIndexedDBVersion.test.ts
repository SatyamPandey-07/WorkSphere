import "fake-indexeddb/auto";
import fs from "fs";
import path from "path";
import { DB_NAME, DB_VERSION } from "../../lib/offlineReviewSync";

describe("Issue #9617 - Service Worker IndexedDB Version Synchronization", () => {
  const swPath = path.resolve(process.cwd(), "public/sw.js");
  const swCode = fs.readFileSync(swPath, "utf8");

  // Helper to extract and run the SW openIndexedDB function in test scope
  function getSWOpenIndexedDB() {
    const fnMatch = swCode.match(
      /let swDb = null;[\s\S]*?function openIndexedDB\(\) \{[\s\S]*?\n\}/,
    );
    if (!fnMatch)
      throw new Error("Could not find openIndexedDB in public/sw.js");
    const fnDef = fnMatch[0] + "; return openIndexedDB;";
    const factory = new Function(fnDef);
    return factory();
  }

  it("ensures public/sw.js matches the page-side schema version (version 9)", () => {
    expect(swCode).not.toContain('indexedDB.open("worksphere-offline", 7)');
    expect(swCode).toContain('indexedDB.open("worksphere-offline", 9)');
    expect(DB_VERSION).toBe(9);
  });

  it("creates all required object stores when Service Worker opens a fresh database", async () => {
    const swOpen = getSWOpenIndexedDB();
    const swDb: IDBDatabase = await swOpen();

    expect(swDb.version).toBe(9);
    expect(swDb.name).toBe("worksphere-offline");

    const requiredStores = [
      "venues",
      "favorites",
      "searches",
      "pendingActions",
      "imageCacheLRU",
      "receiptExports",
      "pendingFavorites",
      "availabilityDeltas",
      "recentlyViewedVenues",
      "pendingReviews",
      "preference_rankings",
      "queued_reviews",
      "unsyncedReviewDrafts",
    ];

    for (const store of requiredStores) {
      expect(swDb.objectStoreNames.contains(store)).toBe(true);
    }

    swDb.close();
  });

  it("eliminates VersionError when Service Worker opens worksphere-offline at version 9", async () => {
    // 1. Page opens worksphere-offline at version 9
    const pageOpenReq = indexedDB.open(DB_NAME, 9);
    const pageDb = await new Promise<IDBDatabase>((resolve, reject) => {
      pageOpenReq.onsuccess = () => resolve(pageOpenReq.result);
      pageOpenReq.onerror = () => reject(pageOpenReq.error);
    });
    expect(pageDb.version).toBe(9);
    pageDb.close();

    // 2. Service worker opens the same database at version 9 without VersionError
    const swOpen = getSWOpenIndexedDB();
    const swDb: IDBDatabase = await swOpen();

    expect(swDb).toBeDefined();
    expect(swDb.name).toBe("worksphere-offline");
    expect(swDb.version).toBe(9);
    swDb.close();
  });

  it("preserves pending offline queue data when accessed by service worker", async () => {
    const swOpen1 = getSWOpenIndexedDB();
    const db1: IDBDatabase = await swOpen1();

    await new Promise<void>((resolve, reject) => {
      const tx = db1.transaction("pendingActions", "readwrite");
      const store = tx.objectStore("pendingActions");
      store.add({ type: "CHECKIN", venueId: "venue-999" });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db1.close();

    // Reopen and verify data persisted across connections
    const swOpen2 = getSWOpenIndexedDB();
    const db2: IDBDatabase = await swOpen2();

    const actions = await new Promise<any[]>((resolve, reject) => {
      const tx = db2.transaction("pendingActions", "readonly");
      const store = tx.objectStore("pendingActions");
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    expect(actions.length).toBeGreaterThanOrEqual(1);
    expect(
      actions.some((a) => a.type === "CHECKIN" && a.venueId === "venue-999"),
    ).toBe(true);

    db2.close();
  });
});

import "fake-indexeddb/auto";
import {
  purgeStaleFloorPlanCache,
  getStaleFloorPlanCacheStats,
  STALE_FLOOR_PLAN_PURGE_LOCK,
  STALE_FLOOR_PLAN_AGE_MS,
} from "../../lib/offline/storageStats";
import { initOfflineDB, closeOfflineDB } from "../../lib/offline/db";
import { LockTimeoutError } from "../../lib/webLock";

describe("Concurrent Stale Floor Plan Purging & Web Locks Coordination (#7953)", () => {
  const originalLocks = navigator.locks;

  function setupDefaultLockMock() {
    let lockQueue = Promise.resolve();
    const mockRequest = jest.fn().mockImplementation((_name, callback) => {
      const next = lockQueue.then(async () => {
        return await callback();
      });
      lockQueue = next.catch(() => {});
      return next;
    });

    Object.defineProperty(navigator, "locks", {
      value: { request: mockRequest },
      configurable: true,
      writable: true,
    });
    return mockRequest;
  }

  beforeEach(async () => {
    closeOfflineDB();
    setupDefaultLockMock();
    const db = await initOfflineDB();
    const tx = db.transaction(
      ["venues", "favorites", "recentlyViewedVenues"],
      "readwrite",
    );
    tx.objectStore("venues").clear();
    tx.objectStore("favorites").clear();
    tx.objectStore("recentlyViewedVenues").clear();
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  });

  afterEach(async () => {
    closeOfflineDB();
    if (originalLocks) {
      Object.defineProperty(navigator, "locks", {
        value: originalLocks,
        configurable: true,
        writable: true,
      });
    } else {
      delete (navigator as any).locks;
    }
    jest.restoreAllMocks();
  });

  async function seedVenueRecords(
    records: Array<{
      id: string;
      name: string;
      floorplan?: any;
      lastAccessedAt?: number;
    }>,
  ) {
    const db = await initOfflineDB();
    const tx = db.transaction(["venues"], "readwrite");
    const store = tx.objectStore("venues");
    for (const record of records) {
      store.put(record);
    }
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // Test 1: Single-tab purge
  it("Test 1 — Single-tab purge: deletes stale records, preserves valid records, returns accurate stats", async () => {
    const now = Date.now();
    const staleTime = now - STALE_FLOOR_PLAN_AGE_MS - 1000;
    const freshTime = now - 1000;

    await seedVenueRecords([
      {
        id: "stale-venue-1",
        name: "Stale Venue",
        floorplan: { svg: "<svg>floor1</svg>", layers: [1, 2] },
        lastAccessedAt: staleTime,
      },
      {
        id: "fresh-venue-2",
        name: "Fresh Venue",
        floorplan: { svg: "<svg>floor2</svg>", layers: [3, 4] },
        lastAccessedAt: freshTime,
      },
    ]);

    const staleEstimate = await getStaleFloorPlanCacheStats(now);
    expect(staleEstimate.count).toBe(1);
    expect(staleEstimate.reclaimableBytes).toBeGreaterThan(0);

    const result = await purgeStaleFloorPlanCache(now);
    expect(result.count).toBe(1);
    expect(result.reclaimableBytes).toBe(staleEstimate.reclaimableBytes);

    // Verify stale record metadata preserved but floorplan stripped
    const db = await initOfflineDB();
    const tx = db.transaction(["venues"], "readonly");
    const store = tx.objectStore("venues");

    const staleVenue = await new Promise<any>((resolve) => {
      const req = store.get("stale-venue-1");
      req.onsuccess = () => resolve(req.result);
    });
    expect(staleVenue).toBeDefined();
    expect(staleVenue.name).toBe("Stale Venue");
    expect(staleVenue.floorplan).toBeUndefined();

    const freshVenue = await new Promise<any>((resolve) => {
      const req = store.get("fresh-venue-2");
      req.onsuccess = () => resolve(req.result);
    });
    expect(freshVenue).toBeDefined();
    expect(freshVenue.name).toBe("Fresh Venue");
    expect(freshVenue.floorplan).toBeDefined();

    // After purge, stale count is 0
    const postStats = await getStaleFloorPlanCacheStats(now);
    expect(postStats.count).toBe(0);
    expect(postStats.reclaimableBytes).toBe(0);
  });

  // Test 2: Concurrent purge requests
  it("Test 2 — Concurrent purge requests: exclusive lock serializes multi-tab cleanup without InvalidStateError", async () => {
    const now = Date.now();
    const staleTime = now - STALE_FLOOR_PLAN_AGE_MS - 5000;

    await seedVenueRecords([
      {
        id: "venue-concurrent-1",
        name: "Concurrent Venue 1",
        floorplan: { svg: "<svg>c1</svg>" },
        lastAccessedAt: staleTime,
      },
    ]);

    let activeLocks = 0;
    let maxConcurrentLocks = 0;
    let lockQueue = Promise.resolve();

    const mockRequest = jest.fn().mockImplementation((name, callback) => {
      expect(name).toBe(STALE_FLOOR_PLAN_PURGE_LOCK);
      const next = lockQueue.then(async () => {
        activeLocks++;
        if (activeLocks > maxConcurrentLocks) {
          maxConcurrentLocks = activeLocks;
        }
        try {
          return await callback();
        } finally {
          activeLocks--;
        }
      });
      lockQueue = next.catch(() => {});
      return next;
    });

    Object.defineProperty(navigator, "locks", {
      value: { request: mockRequest },
      configurable: true,
      writable: true,
    });

    const executionLog: string[] = [];

    // Simulate Tab 1 and Tab 2 triggering purge simultaneously
    const tab1Purge = (async () => {
      executionLog.push("tab1:start");
      const res = await purgeStaleFloorPlanCache(now);
      executionLog.push("tab1:end");
      return res;
    })();

    const tab2Purge = (async () => {
      executionLog.push("tab2:start");
      const res = await purgeStaleFloorPlanCache(now);
      executionLog.push("tab2:end");
      return res;
    })();

    const [tab1Res, tab2Res] = await Promise.all([tab1Purge, tab2Purge]);

    expect(mockRequest).toHaveBeenCalledTimes(2);
    // Lock exclusivity: max concurrent executions must be exactly 1
    expect(maxConcurrentLocks).toBe(1);

    // First tab purges the stale record; second tab finds 0 stale records without failing
    expect(tab1Res.count).toBe(1);
    expect(tab2Res.count).toBe(0);
    expect(tab2Res.reclaimableBytes).toBe(0);
  });

  // Test 3: Lock release after success
  it("Test 3 — Lock release after success: another cleanup operation can acquire the lock after completion", async () => {
    const now = Date.now();
    let lockHeld = false;

    const mockRequest = jest.fn().mockImplementation(async (name, callback) => {
      expect(lockHeld).toBe(false);
      lockHeld = true;
      try {
        return await callback();
      } finally {
        lockHeld = false;
      }
    });

    Object.defineProperty(navigator, "locks", {
      value: { request: mockRequest },
      configurable: true,
      writable: true,
    });

    // Run first purge
    await purgeStaleFloorPlanCache(now);
    expect(lockHeld).toBe(false);

    // Run second purge sequentially
    await purgeStaleFloorPlanCache(now);
    expect(lockHeld).toBe(false);

    expect(mockRequest).toHaveBeenCalledTimes(2);
  });

  // Test 4: Lock release after failure
  it("Test 4 — Lock release after failure: lock is released when operation errors and subsequent cleanup can proceed", async () => {
    const now = Date.now();
    let lockHeld = false;

    const mockRequest = jest.fn().mockImplementation(async (name, callback) => {
      expect(lockHeld).toBe(false);
      lockHeld = true;
      try {
        return await callback();
      } finally {
        lockHeld = false;
      }
    });

    Object.defineProperty(navigator, "locks", {
      value: { request: mockRequest },
      configurable: true,
      writable: true,
    });

    const db = await initOfflineDB();
    const originalTransaction = db.transaction.bind(db);
    jest.spyOn(db, "transaction").mockImplementationOnce(() => {
      throw new Error("Simulated IndexedDB failure during purge");
    });

    // First purge fails
    await expect(purgeStaleFloorPlanCache(now)).rejects.toThrow(
      "Simulated IndexedDB failure during purge",
    );
    expect(lockHeld).toBe(false);

    // Subsequent cleanup must be able to acquire lock and proceed cleanly
    jest.spyOn(db, "transaction").mockImplementation(originalTransaction);
    const subsequentRes = await purgeStaleFloorPlanCache(now);
    expect(subsequentRes).toBeDefined();
    expect(lockHeld).toBe(false);
  });

  // Test 5: Web Locks unavailable
  it("Test 5 — Web Locks unavailable: refuses to purge, opens no transactions, and deletes zero records", async () => {
    const now = Date.now();
    const staleTime = now - STALE_FLOOR_PLAN_AGE_MS - 1000;

    await seedVenueRecords([
      {
        id: "venue-fallback-1",
        name: "Fallback Venue",
        floorplan: { svg: "<svg>fallback</svg>" },
        lastAccessedAt: staleTime,
      },
    ]);

    // Ensure navigator.locks is completely undefined (e.g. older browsers / WebViews)
    delete (navigator as any).locks;

    const db = await initOfflineDB();
    const txSpy = jest.spyOn(db, "transaction");

    // Must safely reject with clear actionable error rather than proceeding unlocked
    await expect(purgeStaleFloorPlanCache(now)).rejects.toThrow(
      /Web Locks API is not supported in this environment, so safe cross-tab coordination cannot be guaranteed/,
    );

    // Verify no destructive IndexedDB transaction was opened
    expect(txSpy).not.toHaveBeenCalled();

    // Verify stale records were NOT deleted
    const checkTx = db.transaction(["venues"], "readonly");
    const record = await new Promise<any>((resolve) => {
      const req = checkTx.objectStore("venues").get("venue-fallback-1");
      req.onsuccess = () => resolve(req.result);
    });

    expect(record).toBeDefined();
    expect(record.floorplan).toEqual({ svg: "<svg>fallback</svg>" });
  });

  // Test 6: IndexedDB transaction lifecycle
  it("Test 6 — IndexedDB transaction lifecycle: awaits transaction completion and handles transaction errors", async () => {
    const now = Date.now();
    const staleTime = now - STALE_FLOOR_PLAN_AGE_MS - 1000;

    await seedVenueRecords([
      {
        id: "venue-tx-1",
        name: "TX Venue",
        floorplan: { svg: "<svg>tx</svg>" },
        lastAccessedAt: staleTime,
      },
    ]);

    const db = await initOfflineDB();
    const originalTx = db.transaction.bind(db);

    // Force transaction abort event
    jest.spyOn(db, "transaction").mockImplementationOnce((stores, mode) => {
      const tx = originalTx(stores, mode);
      queueMicrotask(() => {
        try {
          tx.abort();
        } catch {
          // ignore
        }
      });
      return tx;
    });

    await expect(purgeStaleFloorPlanCache(now)).rejects.toThrow();
  });

  // Test 7: Data integrity
  it("Test 7 — Data integrity: preserves valid floor plans and metadata while purging only expired ones", async () => {
    const now = Date.now();
    const staleTime = now - STALE_FLOOR_PLAN_AGE_MS - 10000;
    const boundaryTime = now - STALE_FLOOR_PLAN_AGE_MS + 10000; // Not stale yet

    await seedVenueRecords([
      {
        id: "venue-stale",
        name: "Stale One",
        floorplan: { data: "stale" },
        lastAccessedAt: staleTime,
      },
      {
        id: "venue-boundary",
        name: "Boundary One",
        floorplan: { data: "valid" },
        lastAccessedAt: boundaryTime,
      },
      {
        id: "venue-no-floorplan",
        name: "No Floorplan One",
        lastAccessedAt: staleTime,
      },
    ]);

    const result = await purgeStaleFloorPlanCache(now);
    expect(result.count).toBe(1);

    const db = await initOfflineDB();
    const tx = db.transaction(["venues"], "readonly");
    const store = tx.objectStore("venues");

    const boundaryVenue = await new Promise<any>((resolve) => {
      const req = store.get("venue-boundary");
      req.onsuccess = () => resolve(req.result);
    });
    expect(boundaryVenue.floorplan).toEqual({ data: "valid" });

    const noFloorplanVenue = await new Promise<any>((resolve) => {
      const req = store.get("venue-no-floorplan");
      req.onsuccess = () => resolve(req.result);
    });
    expect(noFloorplanVenue.name).toBe("No Floorplan One");
  });

  // Test 8: Lock timeout handling
  it("Test 8 — Lock timeout handling: rejects with LockTimeoutError when lock cannot be acquired", async () => {
    const mockRequest = jest.fn().mockImplementation(() => {
      return new Promise(() => {}); // never resolves
    });

    Object.defineProperty(navigator, "locks", {
      value: { request: mockRequest },
      configurable: true,
      writable: true,
    });

    await expect(
      purgeStaleFloorPlanCache(Date.now(), { timeoutMs: 50 }),
    ).rejects.toThrow(LockTimeoutError);
  });
});

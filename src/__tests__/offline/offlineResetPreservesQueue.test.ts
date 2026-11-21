import { SyncQueueManager } from "@/lib/offline/SyncQueueManager";
import * as dbModule from "@/lib/offline/db";

/**
 * The non-destructive reset must keep pending items that are stored in
 * IndexedDB, not only the in-memory fallback queue (#7912). These tests use the
 * real fake-indexeddb from jest.setup.js.
 */
describe("resetDatabaseNonDestructive keeps stored pending items (#7912)", () => {
  beforeEach(async () => {
    dbModule.closeOfflineDB();
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase(dbModule.OFFLINE_DB_NAME);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    SyncQueueManager.resetInstance();
    dbModule.closeOfflineDB();
  });

  it("restores an item that was saved to IndexedDB", async () => {
    const manager = new SyncQueueManager();
    const queued = await manager.enqueue({
      entity: "review",
      action: "create",
      payload: { venueId: "venue-1", rating: 4 },
    });
    expect(manager.isUsingInMemoryFallback()).toBe(false);
    expect(await manager.getPendingCount()).toBe(1);

    const result = await manager.resetDatabaseNonDestructive();

    expect(result.restoredCount).toBe(1);
    expect(await manager.getPendingCount()).toBe(1);
    expect(await manager.getItem(queued.id)).toMatchObject({
      id: queued.id,
      entity: "review",
      payload: { venueId: "venue-1", rating: 4 },
    });
  });

  it("restores stored and in-memory items together, each once", async () => {
    const manager = new SyncQueueManager();
    const stored = await manager.enqueue({
      entity: "review",
      action: "create",
      payload: { text: "stored" },
    });

    // The next write fails, so the item lands in the in-memory fallback.
    jest
      .spyOn(dbModule, "initOfflineDB")
      .mockRejectedValueOnce(new DOMException("Blocked", "VersionError"));
    const inMemory = await manager.enqueue({
      entity: "note",
      action: "update",
      payload: { text: "in memory" },
    });
    expect(manager.isUsingInMemoryFallback()).toBe(true);

    const result = await manager.resetDatabaseNonDestructive();

    expect(result.restoredCount).toBe(2);
    expect(manager.isUsingInMemoryFallback()).toBe(false);
    const ids = (await manager.getQueue()).map((item) => item.id).sort();
    expect(ids).toEqual([stored.id, inMemory.id].sort());
  });

  it("restores an item found in both places once, using the in-memory copy", async () => {
    const preserved = {
      id: "same-id",
      entity: "review",
      action: "create",
      payload: { version: "in-memory" },
      timestamp: 2,
      retryCount: 0,
    };
    const db = await dbModule.initOfflineDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(["pending_sync_queue"], "readwrite");
      tx.objectStore("pending_sync_queue").put({
        ...preserved,
        payload: { version: "stored" },
        timestamp: 1,
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    const result = await dbModule.resetOfflineDBNonDestructive([preserved]);

    expect(result.restoredCount).toBe(1);
    const fresh = await dbModule.initOfflineDB();
    const items = await new Promise<unknown[]>((resolve, reject) => {
      const request = fresh
        .transaction(["pending_sync_queue"], "readonly")
        .objectStore("pending_sync_queue")
        .getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    expect(items).toEqual([preserved]);
  });

  it("restores nothing when there is nothing pending", async () => {
    const result = await dbModule.resetOfflineDBNonDestructive();
    expect(result.restoredCount).toBe(0);
  });
});

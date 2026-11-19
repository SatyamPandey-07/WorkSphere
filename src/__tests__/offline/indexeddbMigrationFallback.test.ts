import { SyncQueueManager } from "@/lib/offline/SyncQueueManager";
import * as dbModule from "@/lib/offline/db";

describe("IndexedDB Version Migration Failure & Fallback (#7223)", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    SyncQueueManager.resetInstance();
  });

  it("recovers gracefully from schema VersionError by falling back to in-memory queue and dispatching a warning toast", async () => {
    const versionError = new DOMException(
      "The requested version (3) is less than the existing version (4).",
      "VersionError",
    );
    jest.spyOn(dbModule, "initOfflineDB").mockRejectedValue(versionError);

    const warningToastMock = jest.fn();
    const manager = SyncQueueManager.getInstance({
      onWarningToast: warningToastMock,
    });

    const queuedItem = await manager.enqueue({
      entity: "checkin",
      action: "create",
      payload: { venueId: "venue-101", timestamp: 1700000000 },
    });

    expect(queuedItem.id).toBeDefined();
    expect(manager.isUsingInMemoryFallback()).toBe(true);
    expect(warningToastMock).toHaveBeenCalledTimes(1);
    expect(warningToastMock).toHaveBeenCalledWith(
      expect.stringContaining("in-memory sync queue"),
    );

    const items = await manager.getQueue("checkin");
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe(queuedItem.id);
  });

  it("flushes pending items in in-memory fallback queue automatically when online", async () => {
    jest
      .spyOn(dbModule, "initOfflineDB")
      .mockRejectedValue(new DOMException("Version mismatch", "VersionError"));

    const manager = SyncQueueManager.getInstance();

    await manager.enqueue({
      entity: "amenity_vote",
      action: "create",
      payload: { venueId: "venue-202", amenityId: "wifi", vote: 1 },
    });
    await manager.enqueue({
      entity: "amenity_vote",
      action: "create",
      payload: { venueId: "venue-203", amenityId: "outlets", vote: 1 },
    });

    expect(await manager.getPendingCount("amenity_vote")).toBe(2);

    const syncedPayloads: unknown[] = [];
    manager.registerHandler("amenity_vote", async (item) => {
      syncedPayloads.push(item.payload);
      return true;
    });

    // Simulate browser coming back online
    Object.defineProperty(navigator, "onLine", {
      value: true,
      configurable: true,
    });
    window.dispatchEvent(new Event("online"));

    // Allow async flush microtasks to settle
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(syncedPayloads).toHaveLength(2);
    expect(await manager.getPendingCount("amenity_vote")).toBe(0);
  });

  it("performs non-destructive database reset while preserving pending in-memory queue items", async () => {
    jest
      .spyOn(dbModule, "initOfflineDB")
      .mockRejectedValueOnce(new DOMException("Blocked", "VersionError"));

    const resetSpy = jest
      .spyOn(dbModule, "resetOfflineDBNonDestructive")
      .mockResolvedValue({ restoredCount: 1 });

    const manager = SyncQueueManager.getInstance();

    await manager.enqueue({
      entity: "review",
      action: "create",
      payload: { venueId: "venue-303", rating: 5 },
    });

    const result = await manager.resetDatabaseNonDestructive();

    expect(resetSpy).toHaveBeenCalledTimes(1);
    expect(result.restoredCount).toBe(1);
    expect(manager.isUsingInMemoryFallback()).toBe(false);
  });
});
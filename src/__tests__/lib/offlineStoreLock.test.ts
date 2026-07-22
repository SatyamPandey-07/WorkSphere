import {
  queueOfflineFavorite,
  getQueuedFavorites,
  withWebLock,
} from "../../lib/offlineStore";

describe("IndexedDB Multi-Tab Lock & Deadlock Prevention (#910)", () => {
  it("uses Web Locks API (navigator.locks) to serialize multi-tab storage access", async () => {
    let lockQueue = Promise.resolve();
    const mockRequest = jest.fn().mockImplementation((_name, callback) => {
      const next = lockQueue.then(() => callback());
      lockQueue = next.catch(() => {});
      return next;
    });

    // Mock navigator.locks if missing in test environment
    Object.defineProperty(navigator, "locks", {
      value: { request: mockRequest },
      configurable: true,
      writable: true,
    });

    const executionOrder: string[] = [];

    const action1 = withWebLock(async () => {
      executionOrder.push("start-1");
      await new Promise((r) => setTimeout(r, 20));
      executionOrder.push("end-1");
    });

    const action2 = withWebLock(async () => {
      executionOrder.push("start-2");
      await new Promise((r) => setTimeout(r, 10));
      executionOrder.push("end-2");
    });

    await Promise.all([action1, action2]);

    expect(mockRequest).toHaveBeenCalled();
    expect(executionOrder).toEqual(["start-1", "end-1", "start-2", "end-2"]);
  });

  it("handles concurrent queueOfflineFavorite requests without deadlock", async () => {
    await Promise.all([
      queueOfflineFavorite("venue-101", "ADD"),
      queueOfflineFavorite("venue-102", "ADD"),
      queueOfflineFavorite("venue-103", "REMOVE"),
    ]);

    const queued = await getQueuedFavorites();
    expect(queued).toBeDefined();
  });
});

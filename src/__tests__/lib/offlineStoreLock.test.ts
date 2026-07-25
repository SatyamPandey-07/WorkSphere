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

  describe("Web Locks API Fallback (Issue #1811)", () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
      jest.restoreAllMocks();
    });

    it("executes the callback if navigator.locks.request hangs for 5 seconds", async () => {
      const mockRequest = jest.fn().mockImplementation(() => {
        // Simulates a hanging lock acquisition (e.g. Firefox Private Browsing)
        return new Promise(() => {}); // never resolves
      });

      Object.defineProperty(navigator, "locks", {
        value: { request: mockRequest },
        configurable: true,
        writable: true,
      });

      const callback = jest.fn().mockResolvedValue("success");
      const promise = withWebLock(callback);

      // Advance timers by 4.9 seconds - should not trigger
      jest.advanceTimersByTime(4900);

      // Wait for any pending microtasks
      await Promise.resolve();
      expect(callback).not.toHaveBeenCalled();

      // Advance to 5 seconds
      jest.advanceTimersByTime(100);

      // Let microtasks flush for the timeout handler to execute the callback
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(callback).toHaveBeenCalledTimes(1);

      // We need to use real timers for the await on the actual promise
      jest.useRealTimers();
      const result = await promise;
      expect(result).toBe("success");
    });

    it("does not execute the callback twice if the lock eventually resolves after timeout", async () => {
      let hangingResolve: (value: any) => void;
      const mockRequest = jest.fn().mockImplementation((_name, cb) => {
        return new Promise((resolve) => {
          hangingResolve = () => resolve(cb());
        });
      });

      Object.defineProperty(navigator, "locks", {
        value: { request: mockRequest },
        configurable: true,
        writable: true,
      });

      const callback = jest.fn().mockResolvedValue("success");
      const promise = withWebLock(callback);

      // Advance past 5s
      jest.advanceTimersByTime(5000);

      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(callback).toHaveBeenCalledTimes(1);

      // Lock acquires late
      hangingResolve!(undefined);

      await Promise.resolve();
      await Promise.resolve();

      // Callback should still be called exactly once
      expect(callback).toHaveBeenCalledTimes(1);

      jest.useRealTimers();
      const result = await promise;
      expect(result).toBe("success");
    });
  });
});

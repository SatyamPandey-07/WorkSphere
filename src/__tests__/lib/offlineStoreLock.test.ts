import {
  queueOfflineFavorite,
  getQueuedFavorites,
  withWebLock,
} from "../../lib/offlineStore";
import { LockTimeoutError } from "../../lib/webLock";

describe("IndexedDB Multi-Tab Lock & Deadlock Prevention (#910)", () => {
  it("uses Web Locks API (navigator.locks) to serialize multi-tab storage access", async () => {
    let lockQueue = Promise.resolve();
    // New signature: request(name, options, callback) — options may be the
    // AbortSignal options object; we accept and ignore it in the mock.
    const mockRequest = jest
      .fn()
      .mockImplementation((_name, _options, callback) => {
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

  describe("Web Locks API Timeout (Issue #2118)", () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
      jest.restoreAllMocks();
    });

    it("rejects with LockTimeoutError and does NOT execute the callback when the lock hangs", async () => {
      // Simulate a hanging lock that never resolves (e.g. Firefox Private Browsing).
      // The mock must honour the AbortSignal so that aborting causes rejection.
      const mockRequest = jest
        .fn()
        .mockImplementation((_name, options: LockOptions, _cb) => {
          return new Promise((_resolve, reject) => {
            // When the AbortController fires, reject with an AbortError just
            // as a real browser would.
            options.signal?.addEventListener("abort", () => {
              const err = new DOMException("Lock request aborted", "AbortError");
              reject(err);
            });
          });
        });

      Object.defineProperty(navigator, "locks", {
        value: { request: mockRequest },
        configurable: true,
        writable: true,
      });

      const callback = jest.fn().mockResolvedValue("success");
      const promise = withWebLock(callback);

      // Just before the 5 s threshold — callback must not have been touched.
      jest.advanceTimersByTime(4900);
      await Promise.resolve();
      expect(callback).not.toHaveBeenCalled();

      // Advance past the threshold.
      jest.advanceTimersByTime(100);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      // The critical section must NEVER be invoked without a held lock.
      expect(callback).not.toHaveBeenCalled();

      jest.useRealTimers();
      await expect(promise).rejects.toBeInstanceOf(LockTimeoutError);
    });

    it("does not execute the callback at all if the lock never resolves before timeout", async () => {
      // Same hanging-lock scenario; verify the callback stays at 0 invocations
      // even after the timeout fires and the AbortController cancels the request.
      const mockRequest = jest
        .fn()
        .mockImplementation((_name, options: LockOptions, _cb) => {
          return new Promise((_resolve, reject) => {
            options.signal?.addEventListener("abort", () => {
              reject(new DOMException("Lock request aborted", "AbortError"));
            });
          });
        });

      Object.defineProperty(navigator, "locks", {
        value: { request: mockRequest },
        configurable: true,
        writable: true,
      });

      const callback = jest.fn().mockResolvedValue("success");
      const promise = withWebLock(callback);

      jest.advanceTimersByTime(5000);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(callback).toHaveBeenCalledTimes(0);

      jest.useRealTimers();
      await expect(promise).rejects.toBeInstanceOf(LockTimeoutError);
    });
  });
});

/**
 * OfflineMutationQueue.test.ts
 *
 * Tests for Issue #9618: Background SyncManager API retry loop with exponential jitter backoff.
 * Verifies all acceptance criteria:
 * 1. Successfully registers one-shot background sync tags on supported browsers.
 * 2. Applies Decorrelated Jitter backoff during repeated API 5xx errors.
 * 3. Graceful fallback to window online event listeners on iOS Safari.
 */

import {
  OfflineMutationQueue,
  DEFAULT_SYNC_TAG,
  IndexedDBMutationStorage,
} from "@/core/sync/OfflineMutationQueue";
import {
  calculateFullJitterBackoff,
  calculateDecorrelatedJitterBackoff,
} from "@/lib/utils/backoff";
import {
  registerOfflineMutationSyncHandler,
  handleOfflineMutationSync,
} from "@/sw";
import * as queueLib from "@/lib/queue";

describe("Decorrelated Jitter Backoff Algorithm (#9618)", () => {
  it("bounds output between baseDelay and min(maxDelay, prevDelay * factor)", () => {
    // When random() returns 0, delay is baseDelay
    const minDelay = calculateDecorrelatedJitterBackoff(1000, {
      baseDelay: 1000,
      maxDelay: 30000,
      factor: 3,
      random: () => 0,
    });
    expect(minDelay).toBe(1000);

    // When random() returns 1, delay is prevDelay * factor (1000 * 3 = 3000)
    const maxDelay = calculateDecorrelatedJitterBackoff(1000, {
      baseDelay: 1000,
      maxDelay: 30000,
      factor: 3,
      random: () => 1,
    });
    expect(maxDelay).toBe(3000);

    // Mid-point sample
    const midDelay = calculateDecorrelatedJitterBackoff(1000, {
      baseDelay: 1000,
      maxDelay: 30000,
      factor: 3,
      random: () => 0.5,
    });
    expect(midDelay).toBe(2000);
  });

  it("caps sleep delay at maxDelay", () => {
    const capped = calculateDecorrelatedJitterBackoff(20000, {
      baseDelay: 1000,
      maxDelay: 30000,
      factor: 3,
      random: () => 1,
    });
    expect(capped).toBe(30000);
  });

  it("handles non-finite or invalid input arguments safely", () => {
    expect(calculateDecorrelatedJitterBackoff(NaN)).toBeGreaterThanOrEqual(0);
    expect(calculateDecorrelatedJitterBackoff(1000, { baseDelay: -500 })).toBe(
      0,
    );
    expect(calculateDecorrelatedJitterBackoff(1000, { maxDelay: -100 })).toBe(
      0,
    );
  });

  it("handles when previousDelay is less than baseDelay", () => {
    const delay = calculateDecorrelatedJitterBackoff(200, {
      baseDelay: 1000,
      maxDelay: 10000,
      factor: 3,
      random: () => 0,
    });
    expect(delay).toBe(1000);
  });
});

describe("Full Jitter Backoff Algorithm (#9618)", () => {
  it("prevents thundering herd on reconnection by distributing delay from 0 to ceiling", () => {
    const zero = calculateFullJitterBackoff(1, {
      baseDelay: 1000,
      maxDelay: 10000,
      random: () => 0,
    });
    expect(zero).toBe(0);

    const full = calculateFullJitterBackoff(1, {
      baseDelay: 1000,
      maxDelay: 10000,
      random: () => 1,
    });
    expect(full).toBe(1000);

    const half = calculateFullJitterBackoff(1, {
      baseDelay: 1000,
      maxDelay: 10000,
      random: () => 0.5,
    });
    expect(half).toBe(500);
  });
});

describe("OfflineMutationQueue - Acceptance Criteria 1: Background Sync Registration", () => {
  beforeEach(() => {
    delete (window as any).SyncManager;
    delete (global as any).SyncManager;
  });

  afterEach(() => {
    delete (window as any).SyncManager;
    delete (global as any).SyncManager;
  });

  it("successfully registers one-shot background sync tags on supported browsers", async () => {
    const registerMock = jest.fn().mockResolvedValue(undefined);
    (window as any).SyncManager = function SyncManager() {};
    Object.defineProperty(navigator, "serviceWorker", {
      value: {
        ready: Promise.resolve({
          sync: {
            register: registerMock,
          },
        }),
      },
      configurable: true,
      writable: true,
    });

    const queue = new OfflineMutationQueue({
      syncTag: DEFAULT_SYNC_TAG,
    });

    expect(queue.isBackgroundSyncSupported()).toBe(true);

    const registered = await queue.registerBackgroundSync();
    expect(registered).toBe(true);
    expect(registerMock).toHaveBeenCalledWith(DEFAULT_SYNC_TAG);
    expect(queue.isUsingFallback()).toBe(false);

    queue.destroy();
  });

  it("allows registering custom sync tags", async () => {
    const registerMock = jest.fn().mockResolvedValue(undefined);
    (window as any).SyncManager = function SyncManager() {};
    Object.defineProperty(navigator, "serviceWorker", {
      value: {
        ready: Promise.resolve({
          sync: {
            register: registerMock,
          },
        }),
      },
      configurable: true,
      writable: true,
    });

    const queue = new OfflineMutationQueue();
    await queue.registerBackgroundSync("booking-mutation-sync");

    expect(registerMock).toHaveBeenCalledWith("booking-mutation-sync");
    queue.destroy();
  });
});

describe("OfflineMutationQueue - Acceptance Criteria 2: Decorrelated Jitter Backoff on 5xx Errors", () => {
  beforeEach(() => {
    Object.defineProperty(navigator, "onLine", {
      value: true,
      configurable: true,
      writable: true,
    });
  });

  it("applies Decorrelated Jitter backoff during repeated API 5xx errors", async () => {
    const mockFetch = jest.fn().mockImplementation(async () => {
      return {
        ok: false,
        status: 503,
      };
    });

    const queue = new OfflineMutationQueue({
      baseDelayMs: 100,
      maxDelayMs: 2000,
      decorrelatedFactor: 3,
      customFetch: mockFetch as any,
      maxRetries: 3,
      applyFullJitterOnReconnection: false,
    });

    await queue.enqueue({
      endpoint: "/api/bookings",
      method: "POST",
      payload: { venueId: "venue-123", slots: [10, 11] },
    });

    expect(queue.getCurrent5xxDelay()).toBe(100);

    // Initial flush: returns 503
    await queue.flush({ skipDelay: true });
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const firstDelay = queue.getCurrent5xxDelay();
    expect(firstDelay).toBeGreaterThanOrEqual(100);
    expect(firstDelay).toBeLessThanOrEqual(300);

    // Second flush: another 503
    await queue.flush({ skipDelay: true });
    expect(mockFetch).toHaveBeenCalledTimes(2);

    const secondDelay = queue.getCurrent5xxDelay();
    expect(secondDelay).toBeGreaterThanOrEqual(100);
    expect(secondDelay).toBeLessThanOrEqual(Math.min(2000, firstDelay * 3));

    // Third flush: reaches max retries
    await queue.flush({ skipDelay: true });
    expect(mockFetch).toHaveBeenCalledTimes(3);

    const items = await queue.getQueue();
    expect(items[0].status).toBe("FAILED");
    expect(items[0].retryCount).toBe(3);
    expect(items[0].lastError).toContain("503");

    queue.destroy();
  });

  it("resets 5xx decorrelated delay back to baseDelayMs after a successful 2xx request", async () => {
    let shouldSucceed = false;
    const mockFetch = jest.fn().mockImplementation(async () => {
      if (shouldSucceed) {
        return { ok: true, status: 200 };
      }
      return { ok: false, status: 500 };
    });

    const queue = new OfflineMutationQueue({
      baseDelayMs: 200,
      maxDelayMs: 5000,
      customFetch: mockFetch as any,
      applyFullJitterOnReconnection: false,
    });

    await queue.enqueue({
      endpoint: "/api/bookings",
      method: "POST",
      payload: { id: "b1" },
    });

    // 500 Server Error
    await queue.flush({ skipDelay: true });
    expect(queue.getCurrent5xxDelay()).toBeGreaterThanOrEqual(200);

    // Successful retry
    shouldSucceed = true;
    await queue.flush({ skipDelay: true });
    expect(queue.getCurrent5xxDelay()).toBe(200);

    const queueItems = await queue.getQueue();
    expect(queueItems.length).toBe(0);

    queue.destroy();
  });

  it("does not retry 4xx client errors indefinitely, immediately marks FAILED", async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
    });

    const queue = new OfflineMutationQueue({
      customFetch: mockFetch as any,
      applyFullJitterOnReconnection: false,
    });

    await queue.enqueue({
      endpoint: "/api/bookings",
      method: "POST",
      payload: { invalid: true },
    });

    await queue.flush({ skipDelay: true });
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const items = await queue.getQueue();
    expect(items[0].status).toBe("FAILED");
    expect(items[0].lastError).toContain("400");

    queue.destroy();
  });
});

describe("OfflineMutationQueue - Acceptance Criteria 3: Graceful Fallback on iOS Safari", () => {
  let windowAddSpy: jest.SpyInstance;
  let windowRemoveSpy: jest.SpyInstance;
  let docAddSpy: jest.SpyInstance;
  let docRemoveSpy: jest.SpyInstance;

  beforeEach(() => {
    delete (window as any).SyncManager;
    delete (global as any).SyncManager;
    Object.defineProperty(navigator, "onLine", {
      value: true,
      configurable: true,
      writable: true,
    });
    windowAddSpy = jest.spyOn(window, "addEventListener");
    windowRemoveSpy = jest.spyOn(window, "removeEventListener");
    docAddSpy = jest.spyOn(document, "addEventListener");
    docRemoveSpy = jest.spyOn(document, "removeEventListener");
  });

  afterEach(() => {
    windowAddSpy.mockRestore();
    windowRemoveSpy.mockRestore();
    docAddSpy.mockRestore();
    docRemoveSpy.mockRestore();
    delete (window as any).SyncManager;
    delete (global as any).SyncManager;
  });

  it("gracefully falls back to window online and visibilitychange listeners on iOS Safari", async () => {
    const mockFetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });

    const queue = new OfflineMutationQueue({
      customFetch: mockFetch as any,
      applyFullJitterOnReconnection: false,
    });

    expect(queue.isBackgroundSyncSupported()).toBe(false);
    expect(queue.isUsingFallback()).toBe(true);
    expect(windowAddSpy).toHaveBeenCalledWith("online", expect.any(Function));
    expect(docAddSpy).toHaveBeenCalledWith(
      "visibilitychange",
      expect.any(Function),
    );

    // Enqueue an item
    await queue.enqueue({
      endpoint: "/api/bookings",
      method: "POST",
      payload: { room: "conference-1" },
    });

    // Simulate user reconnecting to Wi-Fi: dispatch online event
    window.dispatchEvent(new Event("online"));

    // Allow async flush to settle
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(mockFetch).toHaveBeenCalled();

    // Verify cleanup removes listeners
    queue.destroy();
    expect(windowRemoveSpy).toHaveBeenCalledWith(
      "online",
      expect.any(Function),
    );
  });
});

describe("Service Worker Sync Event Handler Integration (#9618)", () => {
  beforeEach(() => {
    Object.defineProperty(navigator, "onLine", {
      value: true,
      configurable: true,
      writable: true,
    });
  });

  it("registers and processes sync event with DEFAULT_SYNC_TAG", async () => {
    const listeners: Record<string, (event: any) => void> = {};
    const mockScope = {
      addEventListener: jest.fn((event: string, cb: any) => {
        listeners[event] = cb;
      }),
    };

    const mockFetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    const queue = new OfflineMutationQueue({
      customFetch: mockFetch as any,
      applyFullJitterOnReconnection: false,
    });

    await queue.enqueue({
      endpoint: "/api/bookings",
      method: "POST",
      payload: { seatId: "seat-42" },
    });

    registerOfflineMutationSyncHandler(queue, mockScope);
    expect(mockScope.addEventListener).toHaveBeenCalledWith(
      "sync",
      expect.any(Function),
    );

    let waitUntilPromise: Promise<any> | null = null;
    const syncEvent = {
      tag: DEFAULT_SYNC_TAG,
      waitUntil: jest.fn((p: Promise<any>) => {
        waitUntilPromise = p;
      }),
    };

    listeners["sync"](syncEvent);
    expect(syncEvent.waitUntil).toHaveBeenCalled();

    await waitUntilPromise;
    expect(mockFetch).toHaveBeenCalled();

    const pending = await queue.getPendingMutations();
    expect(pending.length).toBe(0);

    queue.destroy();
  });

  it("handleOfflineMutationSync flushes the queue directly", async () => {
    const mockFetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    const queue = new OfflineMutationQueue({
      customFetch: mockFetch as any,
      applyFullJitterOnReconnection: false,
    });
    await queue.enqueueBooking({ room: "R1" });
    const res = await handleOfflineMutationSync(queue);
    expect(res.succeeded).toBe(1);
    expect(mockFetch).toHaveBeenCalled();
    queue.destroy();
  });
});

describe("src/lib/queue.ts re-export check", () => {
  it("exports OfflineMutationQueue and offlineMutationQueue alongside pushJob", () => {
    expect(queueLib.OfflineMutationQueue).toBeDefined();
    expect(queueLib.offlineMutationQueue).toBeDefined();
    expect(queueLib.DEFAULT_SYNC_TAG).toBe("sync-offline-mutations");
    expect(queueLib.pushJob).toBeDefined();
    expect(queueLib.getJobStatus).toBeDefined();
    expect(queueLib.updateJobStatus).toBeDefined();
  });
});

describe("OfflineMutationQueue - Booking helper and payload serialization", () => {
  it("enqueueBooking sets default endpoint and method for bookings", async () => {
    const queue = new OfflineMutationQueue({
      applyFullJitterOnReconnection: false,
    });

    const mutation = await queue.enqueueBooking({
      venueId: "venue-99",
      date: "2026-12-01",
    });

    expect(mutation.endpoint).toBe("/api/bookings");
    expect(mutation.method).toBe("POST");
    expect(mutation.payload).toEqual({
      venueId: "venue-99",
      date: "2026-12-01",
    });

    const items = await queue.getQueue();
    expect(items.length).toBe(1);
    queue.destroy();
  });

  it("handles string payloads without double-stringifying", async () => {
    let sentBody: any;
    const mockFetch = jest.fn().mockImplementation(async (_url, init) => {
      sentBody = init.body;
      return { ok: true, status: 200 };
    });

    const queue = new OfflineMutationQueue({
      customFetch: mockFetch as any,
      applyFullJitterOnReconnection: false,
    });

    await queue.enqueue({
      endpoint: "/api/raw",
      method: "POST",
      payload: "already-stringified-raw-content",
    });

    await queue.flush({ skipDelay: true });
    expect(sentBody).toBe("already-stringified-raw-content");

    queue.destroy();
  });
});

describe("IndexedDBMutationStorage", () => {
  it("persists and retrieves mutations in IndexedDB store", async () => {
    const storage = new IndexedDBMutationStorage();

    await storage.clear();

    const sampleMutation = {
      id: "idb-1",
      tag: "sync-offline-mutations",
      endpoint: "/api/bookings",
      method: "POST" as const,
      payload: { seat: "A1" },
      timestamp: Date.now(),
      retryCount: 0,
      status: "PENDING" as const,
    };

    await storage.saveItem(sampleMutation);

    const item = await storage.getItem("idb-1");
    expect(item).toBeDefined();
    expect(item?.id).toBe("idb-1");
    expect(item?.payload).toEqual({ seat: "A1" });

    const all = await storage.getAll();
    expect(all.length).toBe(1);

    await storage.removeItem("idb-1");
    const afterRemove = await storage.getItem("idb-1");
    expect(afterRemove).toBeUndefined();

    await storage.clear();
  });
});

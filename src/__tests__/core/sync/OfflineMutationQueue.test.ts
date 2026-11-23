
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

import 'fake-indexeddb/auto';
import {
  OfflineMutationQueue,
  MUTATION_ROLLBACK_EVENT,
  type MutationRollbackEventDetail,
} from '../../../core/sync/OfflineMutationQueue';

// Vitest / Jest compatibility helper without top-level await
let vitestModule: any = undefined;
try {
  // Use eval('require') or dynamic require if in CommonJS/Jest or Vitest
  if (typeof (globalThis as any).describe === 'undefined') {
    vitestModule = (eval('require'))('vitest');
  }
} catch {
  // Ignore in Jest where require('vitest') isn't needed
}

const testDescribe = (globalThis as any).describe ?? vitestModule?.describe;
const testIt = (globalThis as any).it ?? vitestModule?.it;
const testExpect = (globalThis as any).expect ?? vitestModule?.expect;
const testBeforeEach = (globalThis as any).beforeEach ?? vitestModule?.beforeEach;
const testAfterEach = (globalThis as any).afterEach ?? vitestModule?.afterEach;

// Universal mock helper compatible with both Vitest and Jest
const createSpy = (fn?: (...args: any[]) => any) => {
  if (vitestModule?.vi && typeof vitestModule.vi.fn === 'function') {
    return vitestModule.vi.fn(fn);
  }
  if (typeof (globalThis as any).vi !== 'undefined' && typeof (globalThis as any).vi.fn === 'function') {
    return (globalThis as any).vi.fn(fn);
  }
  if (typeof jest !== 'undefined' && typeof jest.fn === 'function') {
    return jest.fn(fn);
  }
  const spy = (...args: any[]) => {
    spy.calls.push(args);
    return fn ? fn(...args) : undefined;
  };
  spy.calls = [] as any[][];
  return spy;
};

testDescribe('OfflineMutationQueue with Rollback & Concurrency Rejection (#9501)', () => {
  let dbCounter = 0;

  function createTestQueue<T = any>(options: { defaultMaxRetries?: number } = {}) {
    dbCounter += 1;
    return new OfflineMutationQueue<T>({
      dbName: `test-offline-mutations-${Date.now()}-${dbCounter}`,
      defaultMaxRetries: options.defaultMaxRetries ?? 3,
      enablePersistence: true,
    });
  }

  let listeners: Map<string, Set<(ev: any) => void>>;

  testBeforeEach(() => {
    listeners = new Map();
    (globalThis as any).addEventListener = (type: string, listener: any) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
    };
    (globalThis as any).removeEventListener = (type: string, listener: any) => {
      listeners.get(type)?.delete(listener);
    };
    (globalThis as any).dispatchEvent = (event: any) => {
      const type = event.type;
      const set = listeners.get(type);
      if (set) {
        for (const l of set) l(event);
      }
      return true;
    };
    (globalThis as any).window = globalThis;
  });

  testAfterEach(() => {
    delete (globalThis as any).addEventListener;
    delete (globalThis as any).removeEventListener;
    delete (globalThis as any).dispatchEvent;
    delete (globalThis as any).window;
    if (typeof (globalThis as any).vi !== 'undefined') (globalThis as any).vi.clearAllMocks();
    if (typeof jest !== 'undefined') jest.clearAllMocks();
  });

  // Scenario 1: Successful mutation
  testIt('does not execute rollback callback when mutation succeeds', async () => {
    const queue = createTestQueue<{ seat: string }>();
    const rollbackSpy = createSpy();

    queue.enqueue({
      id: 'mut-success',
      type: 'BOOK_SEAT',
      payload: { seat: 'Desk-101' },
      rollbackState: rollbackSpy,
    });

    const summary = await queue.drain(async (mut) => {
      testExpect(mut.id).toBe('mut-success');
    });

    testExpect(summary.succeeded).toEqual(['mut-success']);
    testExpect(rollbackSpy).not.toHaveBeenCalled();
    testExpect(queue.getSnapshot().items).toHaveLength(0);
  });

  // Scenario 2: Single 409 rollback
  testIt('restores pre-mutation state, dispatches event, and cleans journal on HTTP 409', async () => {
    const queue = createTestQueue<{ note: string }>();
    let clientState = 'State A (initial)';
    const rollbackFn = createSpy(() => {
      clientState = 'State A (initial)';
    });

    // Optimistic update
    clientState = 'State B (optimistic)';

    const eventListener = createSpy();
    globalThis.addEventListener(MUTATION_ROLLBACK_EVENT, eventListener as any);

    queue.enqueue({
      id: 'mut-409',
      type: 'UPDATE_NOTE',
      payload: { note: 'new content' },
      rollbackState: rollbackFn,
    });

    const summary = await queue.drain(async (mut) => {
      const err = Object.assign(new Error('Optimistic lock conflict: version mismatch'), {
        status: 409,
      });
      throw err;
    });

    testExpect(summary.failed).toContain('mut-409');
    testExpect(summary.rolledBack).toContain('mut-409');
    testExpect(rollbackFn).toHaveBeenCalledTimes(1);
    testExpect(clientState).toBe('State A (initial)');

    // Verify custom event dispatched
    testExpect(eventListener).toHaveBeenCalledTimes(1);
    const event = (eventListener.mock?.calls?.[0]?.[0] ?? eventListener.calls?.[0]?.[0]) as CustomEvent<MutationRollbackEventDetail>;
    testExpect(event.detail.mutationId).toBe('mut-409');
    testExpect(event.detail.status).toBe(409);
    testExpect(event.detail.rollbackSucceeded).toBe(true);
    testExpect(event.detail.reason).toContain('version mismatch');

    // Verify removed from queue snapshot
    testExpect(queue.getSnapshot().items).toHaveLength(0);

    globalThis.removeEventListener(MUTATION_ROLLBACK_EVENT, eventListener as any);
  });

  // Scenario 3: Single 422 rollback
  testIt('restores pre-mutation state, dispatches event, and cleans journal on HTTP 422', async () => {
    const queue = createTestQueue<{ count: number }>();
    let counter = 5;
    const rollbackFn = createSpy(() => {
      counter = 5;
    });

    counter = 10; // optimistic

    const eventListener = createSpy();
    globalThis.addEventListener(MUTATION_ROLLBACK_EVENT, eventListener as any);

    queue.enqueue({
      id: 'mut-422',
      type: 'SET_COUNT',
      payload: { count: 10 },
      rollbackState: rollbackFn,
    });

    const summary = await queue.drain(async () => {
      const err = Object.assign(new Error('Semantic constraint failure: capacity exceeded'), {
        status: 422,
      });
      throw err;
    });

    testExpect(summary.failed).toContain('mut-422');
    testExpect(summary.rolledBack).toContain('mut-422');
    testExpect(rollbackFn).toHaveBeenCalledTimes(1);
    testExpect(counter).toBe(5);

    testExpect(eventListener).toHaveBeenCalledTimes(1);
    const event = (eventListener.mock?.calls?.[0]?.[0] ?? eventListener.calls?.[0]?.[0]) as CustomEvent<MutationRollbackEventDetail>;
    testExpect(event.detail.mutationId).toBe('mut-422');
    testExpect(event.detail.status).toBe(422);
    testExpect(event.detail.rollbackSucceeded).toBe(true);

    globalThis.removeEventListener(MUTATION_ROLLBACK_EVENT, eventListener as any);
  });

  // Scenario 4: Chained mutation rollback
  testIt('handles chained/dependent mutations without corrupting state or leaving orphaned changes', async () => {
    const queue = createTestQueue();
    let state = 'A';

    // Mutation 1 moves A -> B
    state = 'B';
    const rollbackMut1 = createSpy(() => {
      state = 'A';
    });

    // Mutation 2 moves B -> C (depends on Mutation 1)
    state = 'C';
    const rollbackMut2 = createSpy(() => {
      state = 'B';
    });

    queue.enqueue({
      id: 'mut-1',
      type: 'STEP_1',
      payload: {},
      entityKey: 'document-1',
      rollbackState: rollbackMut1,
    });

    queue.enqueue({
      id: 'mut-2',
      type: 'STEP_2',
      payload: {},
      entityKey: 'document-1',
      dependsOn: 'mut-1',
      rollbackState: rollbackMut2,
    });

    // An unrelated mutation on a different entity
    let unrelatedState = 'Unrelated Active';
    const rollbackUnrelated = createSpy(() => {
      unrelatedState = 'Unrelated Initial';
    });
    queue.enqueue({
      id: 'mut-unrelated',
      type: 'OTHER_ENTITY',
      payload: {},
      entityKey: 'venue-999',
      rollbackState: rollbackUnrelated,
    });

    // Execute drain where mut-1 fails with 409
    const summary = await queue.drain(async (mut) => {
      if (mut.id === 'mut-1') {
        const err = Object.assign(new Error('Optimistic conflict on doc 1'), { status: 409 });
        throw err;
      }
      if (mut.id === 'mut-unrelated') {
        // mut-unrelated succeeds!
        return;
      }
    });

    // Both mut-1 and its dependent mut-2 should be rolled back
    testExpect(rollbackMut2).toHaveBeenCalledTimes(1);
    testExpect(rollbackMut1).toHaveBeenCalledTimes(1);
    // Unrelated mutation was NOT rolled back and succeeded
    testExpect(rollbackUnrelated).not.toHaveBeenCalled();
    testExpect(summary.succeeded).toContain('mut-unrelated');

    // Final state restored cleanly to A
    testExpect(state).toBe('A');

    // The queue now has 0 pending items (mut-1 and mut-2 rolled back, unrelated succeeded)
    testExpect(queue.getSnapshot().items).toHaveLength(0);
  });

  // Scenario 5: Rollback callback failure
  testIt('catches rollback callback exceptions and continues cleanup without getting stuck', async () => {
    const queue = createTestQueue();
    const throwingRollback = createSpy(() => {
      throw new Error('Exploding rollback!');
    });

    const eventListener = createSpy();
    globalThis.addEventListener(MUTATION_ROLLBACK_EVENT, eventListener as any);

    queue.enqueue({
      id: 'mut-faulty-cb',
      type: 'FAULTY',
      payload: {},
      rollbackState: throwingRollback,
    });

    const summary = await queue.drain(async () => {
      const err = Object.assign(new Error('Conflict'), { status: 409 });
      throw err;
    });

    testExpect(summary.rolledBack).toContain('mut-faulty-cb');
    testExpect(throwingRollback).toHaveBeenCalledTimes(1);

    // Event should report rollbackSucceeded: false
    testExpect(eventListener).toHaveBeenCalledTimes(1);
    const event = (eventListener.mock?.calls?.[0]?.[0] ?? eventListener.calls?.[0]?.[0]) as CustomEvent<MutationRollbackEventDetail>;
    testExpect(event.detail.rollbackSucceeded).toBe(false);

    // Queue is clean and not stuck
    testExpect(queue.getSnapshot().items).toHaveLength(0);

    globalThis.removeEventListener(MUTATION_ROLLBACK_EVENT, eventListener as any);
  });

  // Scenario 6: Missing rollback callback
  testIt('handles fatal rejection safely when no rollback callback was provided', async () => {
    const queue = createTestQueue();

    queue.enqueue({
      id: 'mut-no-cb',
      type: 'NO_CALLBACK',
      payload: {},
      // rollbackState omitted
    });

    const summary = await queue.drain(async () => {
      const err = Object.assign(new Error('Conflict'), { status: 409 });
      throw err;
    });

    testExpect(summary.rolledBack).toContain('mut-no-cb');
    testExpect(queue.getSnapshot().items).toHaveLength(0);
  });

  // Scenario 7: Retryable errors
  testIt('does not trigger rollback prematurely on transient network or 5xx errors', async () => {
    const queue = createTestQueue({ defaultMaxRetries: 3 });
    const rollbackSpy = createSpy();

    queue.enqueue({
      id: 'mut-retryable',
      type: 'NETWORK_OP',
      payload: {},
      rollbackState: rollbackSpy,
    });

    const summary = await queue.drain(async () => {
      throw new Error('Failed to fetch (offline)');
    });

    testExpect(rollbackSpy).not.toHaveBeenCalled();
    testExpect(summary.requeued).toContain('mut-retryable');
    testExpect(summary.failed).toHaveLength(0);
    testExpect(summary.rolledBack).toHaveLength(0);

    const snapshot = queue.getSnapshot();
    testExpect(snapshot.pendingCount).toBe(1);
    testExpect(snapshot.items[0].attempts).toBe(1);
  });

  // Scenario 8: Unrelated queued mutations
  testIt('keeps unrelated queued mutations intact when one mutation is rejected', async () => {
    const queue = createTestQueue();

    queue.enqueue({
      id: 'mut-a',
      type: 'TYPE_A',
      payload: { name: 'Item A' },
      entityKey: 'entity-A',
    });

    queue.enqueue({
      id: 'mut-b',
      type: 'TYPE_B',
      payload: { name: 'Item B' },
      entityKey: 'entity-B',
    });

    const summary = await queue.drain(async (mut) => {
      if (mut.id === 'mut-a') {
        const err = Object.assign(new Error('Conflict on A'), { status: 409 });
        throw err;
      }
      // mut-b succeeds
    });

    testExpect(summary.rolledBack).toContain('mut-a');
    testExpect(summary.succeeded).toContain('mut-b');
    testExpect(queue.getSnapshot().items).toHaveLength(0);
  });

  // Scenario 9: Persistence and reload
  testIt('does not replay a rejected mutation after journal cleanup and reload', async () => {
    const sharedDbName = `shared-db-${Date.now()}`;

    // Session 1: Enqueue and fail with 409
    const queueSession1 = new OfflineMutationQueue({
      dbName: sharedDbName,
      enablePersistence: true,
    });
    await queueSession1.init();

    queueSession1.enqueue({
      id: 'mut-persisted-conflict',
      type: 'CONF_OP',
      payload: { v: 1 },
    });

    // Drain with 409
    await queueSession1.drain(async () => {
      const err = Object.assign(new Error('Conflict'), { status: 409 });
      throw err;
    });

    // Session 2: Fresh instance simulating app reload
    const queueSession2 = new OfflineMutationQueue({
      dbName: sharedDbName,
      enablePersistence: true,
    });
    await queueSession2.init();

    // The rejected mutation was cleaned from IndexedDB journal, so it must not exist
    testExpect(queueSession2.getSnapshot().items).toHaveLength(0);

  });
});

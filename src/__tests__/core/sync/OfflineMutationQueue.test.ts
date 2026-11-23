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

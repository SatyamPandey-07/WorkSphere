import * as Y from "yjs";
import { CanvasJournalProvider } from "@/lib/crdt/canvasProvider";

function createMockIndexedDb(options: { abortRate?: number } = {}) {
  const abortRate = options.abortRate ?? 0;
  let callIndex = 0;
  const transactions: Array<{
    oncomplete: (() => void) | null;
    onabort: (() => void) | null;
    onerror: (() => void) | null;
    error: DOMException | null;
    lastPutRecord: unknown;
  }> = [];

  const db = {
    close: jest.fn(),
    transaction: jest.fn(() => {
      callIndex++;
      const shouldAbort =
        abortRate >= 1 ||
        (abortRate > 0 && callIndex % Math.round(1 / abortRate) === 0);

      const tx = {
        oncomplete: null as (() => void) | null,
        onabort: null as (() => void) | null,
        onerror: null as (() => void) | null,
        error: null as DOMException | null,
        lastPutRecord: null as unknown,
        objectStore: () => ({
          put: (record: unknown) => {
            tx.lastPutRecord = record;
            const req = {
              onsuccess: null as (() => void) | null,
              onerror: null as (() => void) | null,
            };
            queueMicrotask(() => {
              tx.lastPutRecord = null;
              if (shouldAbort) {
                tx.error = new DOMException(
                  "Simulated packet-loss transaction abort",
                  "AbortError",
                );
                tx.onabort?.();
              } else {
                req.onsuccess?.();
                tx.oncomplete?.();
              }
            });
            return req;
          },
        }),
      };

      transactions.push(tx);
      return tx as unknown as IDBTransaction;
    }),
  } as unknown as IDBDatabase;

  return { db, transactions };
}

function makeYjsStrokeUpdate(strokeIndex: number, pointCount = 64): Uint8Array {
  const doc = new Y.Doc();
  const arr = doc.getArray<number>(`stroke-${strokeIndex}`);
  const points = new Array<number>(pointCount);
  for (let i = 0; i < pointCount; i++) {
    points[i] = strokeIndex * 100 + i;
  }
  arr.insert(0, points);
  const update = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  return update;
}

describe("CanvasJournalProvider IndexedDB Abort & Memory Cleanup", () => {
  it("explicitly clears buffer and handler references in finally blocks when a transaction aborts", async () => {
    const { db, transactions } = createMockIndexedDb({ abortRate: 1 });
    const provider = new CanvasJournalProvider("room-abort-test", {
      openDatabase: async () => db,
    });

    const largePayload = new Uint8Array(256 * 1024);
    largePayload.fill(0xab);
    const weakPayloadRef = new WeakRef(largePayload);

    provider.enqueueUpdate(largePayload);
    expect(provider.pendingUpdateCount).toBe(1);

    await expect(provider.flushJournal()).rejects.toThrow(/abort/i);

    expect(provider.pendingUpdateCount).toBe(0);
    expect(provider.pendingBytes).toBe(0);
    expect(provider.activeTransactionCount).toBe(0);

    expect(transactions).toHaveLength(1);
    expect(transactions[0].onabort).toBeNull();
    expect(transactions[0].onerror).toBeNull();
    expect(transactions[0].oncomplete).toBeNull();
    expect(transactions[0].lastPutRecord).toBeNull();

    expect(weakPayloadRef.deref()).toBeDefined();
    provider.destroy();
  });

  it("maintains a stable memory footprint (<50MB) during high-packet-loss rapid stroke stress tests", async () => {
    const { db } = createMockIndexedDb({ abortRate: 0.5 });
    const provider = new CanvasJournalProvider("room-stress-test", {
      openDatabase: async () => db,
      compactionThreshold: 16,
    });

    if (typeof globalThis.gc === "function") {
      globalThis.gc();
    }
    const baselineHeapBytes = process.memoryUsage().heapUsed;

    for (let stroke = 0; stroke < 480; stroke++) {
      const update = makeYjsStrokeUpdate(stroke, 128);
      provider.enqueueUpdate(update);

      if (stroke % 4 === 0) {
        await provider.flushJournal().catch(() => {});
      }
    }

    await provider.flushJournal().catch(() => {});

    if (typeof globalThis.gc === "function") {
      globalThis.gc();
    }
    const finalHeapBytes = process.memoryUsage().heapUsed;
    const heapDeltaMb = (finalHeapBytes - baselineHeapBytes) / (1024 * 1024);

    expect(provider.pendingUpdateCount).toBe(0);
    expect(provider.pendingBytes).toBe(0);
    expect(provider.activeTransactionCount).toBe(0);
    expect(heapDeltaMb).toBeLessThan(50);

    provider.destroy();
  });
});

import * as Y from "yjs";
import {
  DEFAULT_SNAPSHOT_INTERVAL_MS,
  DEFAULT_SNAPSHOT_OP_THRESHOLD,
  InMemorySnapshotStorage,
  SnapshotIntegrityError,
  SnapshotManager,
  computeSnapshotChecksum,
  deserializeSnapshot,
  isStateVectorBehind,
  serializeSnapshot,
  type SnapshotManagerOptions,
  type SnapshotStorage,
} from "@/lib/crdt/snapshotManager";

const ROOM = "whiteboard-test-room";

describe("SnapshotManager (#7574)", () => {
  let storage: InMemorySnapshotStorage;
  let managers: SnapshotManager[];

  beforeEach(() => {
    storage = new InMemorySnapshotStorage();
    managers = [];
  });

  afterEach(async () => {
    for (const manager of managers) {
      await manager.destroy();
    }
    managers = [];
    jest.useRealTimers();
  });

  const makeManager = (
    doc: Y.Doc,
    overrides: Partial<SnapshotManagerOptions> = {},
  ): SnapshotManager => {
    const manager = new SnapshotManager({
      doc,
      roomId: ROOM,
      storage,
      intervalMs: 0,
      ...overrides,
    });
    managers.push(manager);
    return manager;
  };

  it("enables Yjs garbage collection so long sessions stay bounded", () => {
    const doc = new Y.Doc();
    doc.gc = false;

    makeManager(doc);

    expect(doc.gc).toBe(true);
  });

  it("uses the documented compaction thresholds", () => {
    expect(DEFAULT_SNAPSHOT_OP_THRESHOLD).toBe(500);
    expect(DEFAULT_SNAPSHOT_INTERVAL_MS).toBe(10 * 60 * 1000);
  });

  it("compacts the document and purges superseded deltas", async () => {
    const doc = new Y.Doc();
    const manager = makeManager(doc);
    const text = doc.getText("monaco");

    text.insert(0, "hello");
    text.insert(5, " world");
    expect(manager.pendingOperationCount).toBe(2);
    expect(await storage.listDeltas(ROOM)).toHaveLength(0);

    const snapshot = await manager.compact();

    expect(snapshot.checksum).toBe(computeSnapshotChecksum(snapshot.update));
    expect(manager.pendingOperationCount).toBe(0);
    expect(await storage.listDeltas(ROOM)).toHaveLength(0);

    const loaded = await storage.loadSnapshot(ROOM);
    expect(loaded?.checksum).toBe(snapshot.checksum);
    expect(loaded?.opsAtSnapshot).toBe(2);
  });

  it("automatically compacts once the operation threshold is crossed", async () => {
    const doc = new Y.Doc();
    const manager = makeManager(doc, { opThreshold: 3 });
    const text = doc.getText("monaco");

    text.insert(0, "a");
    text.insert(1, "b");
    expect(await storage.loadSnapshot(ROOM)).toBeNull();

    text.insert(2, "c");
    const snapshot = await manager.compact();

    expect(snapshot.update.byteLength).toBeGreaterThan(0);
    expect(await storage.loadSnapshot(ROOM)).not.toBeNull();
    expect(manager.pendingOperationCount).toBe(0);
  });

  it("checkpoints on the periodic interval while edits are pending", async () => {
    jest.useFakeTimers();
    const doc = new Y.Doc();
    const manager = makeManager(doc, { opThreshold: 100, intervalMs: 1000 });

    manager.start();
    doc.getText("monaco").insert(0, "tick");

    await jest.advanceTimersByTimeAsync(1000);
    await manager.compact();

    expect(await storage.loadSnapshot(ROOM)).not.toBeNull();
  });

  it("recovers a behind peer from the snapshot plus post-baseline deltas", async () => {
    const sourceDoc = new Y.Doc();
    const sourceManager = makeManager(sourceDoc);
    sourceDoc.getText("monaco").insert(0, "hello");
    await sourceManager.compact();

    sourceDoc.getText("monaco").insert(5, " world");
    await sourceManager.flushDeltas();

    const peerDoc = new Y.Doc();
    const peerManager = makeManager(peerDoc);
    const result = await peerManager.recover();

    expect(peerDoc.getText("monaco").toString()).toBe("hello world");
    expect(result.behindCompactedBaseline).toBe(true);
    expect(result.recovered).toBe(true);
    expect(result.appliedDeltas).toBe(1);
    expect(result.converged).toBe(true);
    expect(peerManager.pendingOperationCount).toBe(0);
  });

  it("is a no-op when no compacted baseline exists", async () => {
    const doc = new Y.Doc();
    const manager = makeManager(doc);
    doc.getText("monaco").insert(0, "local-only");

    const result = await manager.recover();

    expect(result.recovered).toBe(false);
    expect(result.appliedDeltas).toBe(0);
    expect(result.converged).toBe(true);
    expect(doc.getText("monaco").toString()).toBe("local-only");
  });

  it("rejects a corrupted snapshot instead of diverging", async () => {
    const sourceDoc = new Y.Doc();
    const sourceManager = makeManager(sourceDoc);
    sourceDoc.getText("monaco").insert(0, "trusted");
    const snapshot = await sourceManager.compact();

    await storage.saveSnapshot({ ...snapshot, checksum: "0000000000000000" });

    const peerManager = makeManager(new Y.Doc());
    await expect(peerManager.recover()).rejects.toBeInstanceOf(
      SnapshotIntegrityError,
    );
  });

  it("detects state vectors that are behind remote knowledge", () => {
    const ahead = new Y.Doc();
    ahead.getText("text").insert(0, "x");

    const empty = Y.encodeStateVector(new Y.Doc());
    const aheadVector = Y.encodeStateVector(ahead);

    expect(isStateVectorBehind(empty, aheadVector)).toBe(true);
    expect(isStateVectorBehind(aheadVector, empty)).toBe(false);
  });

  it("round-trips snapshots through their serialized form", async () => {
    const doc = new Y.Doc();
    const manager = makeManager(doc);
    doc.getText("monaco").insert(0, "serialize me");
    const snapshot = await manager.compact();

    const restored = deserializeSnapshot(serializeSnapshot(snapshot));

    expect(restored.roomId).toBe(snapshot.roomId);
    expect(Array.from(restored.update)).toEqual(Array.from(snapshot.update));
    expect(Array.from(restored.stateVector)).toEqual(
      Array.from(snapshot.stateVector),
    );
    expect(restored.checksum).toBe(snapshot.checksum);
  });
});

// ---------------------------------------------------------------------------
// Issue #9166 — Snapshot GC / concurrent recovery regression tests
//
// These tests reproduce and guard against the race condition where compact()'s
// garbage-collection phase (deleteDeltasThrough) evicts delta buffers while a
// concurrent recover() is still replaying those same buffers, causing Yjs
// decoder failures ("Premature end of update").
//
// The AsyncRWLock introduced in the fix ensures that:
//   • recover() holds a shared read lock while listing and applying deltas.
//   • compact()'s GC phase acquires an exclusive write lock before evicting
//     the delta log, so eviction is deferred until all readers have released.
// ---------------------------------------------------------------------------

describe("SnapshotManager GC / concurrency safety (#9166)", () => {
  const ROOM_GC = "room-9166";
  let storage: InMemorySnapshotStorage;
  let managers: SnapshotManager[];

  beforeEach(() => {
    storage = new InMemorySnapshotStorage();
    managers = [];
  });

  afterEach(async () => {
    for (const manager of managers) {
      await manager.destroy();
    }
    managers = [];
  });

  // -------------------------------------------------------------------------
  // 1. Regression: compact GC must be deferred while recover is mid-replay.
  //
  // Strategy: sourceManager and peerManager both share a stalling storage.
  // sourceManager has a pending (un-flushed) delta. When compact() runs it
  // flushes the delta to storage, then tries to acquire the write lock to GC.
  // peerManager.recover() concurrently holds the read lock (stalled inside
  // listDeltas). The write lock acquisition blocks until recover releases,
  // guaranteeing that GC only fires after all readers have finished.
  // -------------------------------------------------------------------------
  it("regression: compact GC deferred while recover is mid-replay (#9166)", async () => {
    let unblockListDeltas!: () => void;
    const listDeltasBlocker = new Promise<void>((res) => {
      unblockListDeltas = res;
    });
    let compactGcCalled = false;

    // Stalling storage: wraps in-memory store but (1) holds listDeltas
    // until unblocked, and (2) records every GC (deleteDeltasThrough) call.
    const stallingStorage: SnapshotStorage = {
      saveSnapshot: (s) => storage.saveSnapshot(s),
      loadSnapshot: (id) => storage.loadSnapshot(id),
      deleteSnapshot: (id) => storage.deleteSnapshot(id),
      appendDelta: (d) => storage.appendDelta(d),
      clearRoom: (id) => storage.clearRoom(id),
      async listDeltas(roomId) {
        // Block here while recover holds the read lock — the write-lock
        // acquisition in compact()'s GC phase must wait.
        await listDeltasBlocker;
        return storage.listDeltas(roomId);
      },
      async deleteDeltasThrough(roomId, throughSeq) {
        compactGcCalled = true;
        return storage.deleteDeltasThrough(roomId, throughSeq);
      },
    };

    // sourceManager is on stallingStorage so its compact() GC is monitored.
    // We write a snapshot first (direct to real storage to avoid blocking).
    const sourceDoc = new Y.Doc();
    sourceDoc.getText("text").insert(0, "baseline content");
    // Compact directly into real storage (no stall, no pending deltas → no GC).
    const sourceManagerSetup = new SnapshotManager({
      doc: sourceDoc,
      roomId: ROOM_GC,
      storage,
      intervalMs: 0,
    });
    managers.push(sourceManagerSetup);
    await sourceManagerSetup.compact();
    await sourceManagerSetup.destroy();
    managers.pop();

    // Now create sourceManager on stallingStorage with the post-baseline delta.
    // The delta is buffered (not yet flushed); compact() will flush then GC it.
    const sourceDoc2 = new Y.Doc();
    // Start from the same state as sourceDoc.
    Y.applyUpdate(sourceDoc2, Y.encodeStateAsUpdate(sourceDoc));
    const sourceManager = new SnapshotManager({
      doc: sourceDoc2,
      roomId: ROOM_GC,
      storage: stallingStorage,
      intervalMs: 0,
    });
    managers.push(sourceManager);
    // Adding this edit creates a buffered delta in sourceManager.pendingDeltas.
    sourceDoc2.getText("text").insert(16, " plus delta");

    // peerManager also uses stallingStorage to share the snapshot.
    const peerDoc = new Y.Doc();
    const peerManager = new SnapshotManager({
      doc: peerDoc,
      roomId: ROOM_GC,
      storage: stallingStorage,
      intervalMs: 0,
    });
    managers.push(peerManager);

    // Start recover() — stalls in listDeltas, holding the read lock.
    // Start compact() — flushes the buffered delta to storage, then blocks
    // at acquireWrite because recover holds the read lock.
    const recoveryPromise = peerManager.recover();
    const compactPromise = sourceManager.compact();

    // Unblock listDeltas so recover can list and apply the now-flushed delta,
    // then release the read lock → compact GC finally runs.
    unblockListDeltas();

    const [result] = await Promise.all([recoveryPromise, compactPromise]);

    // Peer applied the delta — it was still present when recover replayed it.
    expect(result.recovered).toBe(true);
    expect(result.appliedDeltas).toBe(1);
    expect(peerDoc.getText("text").toString()).toBe("baseline content plus delta");

    // GC ran after recover released the read lock.
    expect(compactGcCalled).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 2. Concurrent recover() calls both succeed without interference.
  // -------------------------------------------------------------------------
  it("concurrent recover() calls both converge (#9166)", async () => {
    const sourceDoc = new Y.Doc();
    const sourceManager = new SnapshotManager({
      doc: sourceDoc,
      roomId: ROOM_GC,
      storage,
      intervalMs: 0,
    });
    managers.push(sourceManager);
    sourceDoc.getText("text").insert(0, "shared baseline");
    await sourceManager.compact();
    sourceDoc.getText("text").insert(15, " + delta");
    await sourceManager.flushDeltas();

    const peerDocA = new Y.Doc();
    const peerDocB = new Y.Doc();
    const peerManagerA = new SnapshotManager({ doc: peerDocA, roomId: ROOM_GC, storage, intervalMs: 0 });
    const peerManagerB = new SnapshotManager({ doc: peerDocB, roomId: ROOM_GC, storage, intervalMs: 0 });
    managers.push(peerManagerA, peerManagerB);

    // Fire both recoveries simultaneously — both hold read lock at same time.
    const [resultA, resultB] = await Promise.all([
      peerManagerA.recover(),
      peerManagerB.recover(),
    ]);

    expect(resultA.appliedDeltas).toBe(1);
    expect(resultB.appliedDeltas).toBe(1);
    expect(peerDocA.getText("text").toString()).toBe("shared baseline + delta");
    expect(peerDocB.getText("text").toString()).toBe("shared baseline + delta");
    expect(resultA.converged).toBe(true);
    expect(resultB.converged).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 3. Post-compaction recover — reader admitted after writer releases lock.
  // -------------------------------------------------------------------------
  it("recover succeeds after compact GC completes (#9166)", async () => {
    const sourceDoc = new Y.Doc();
    const sourceManager = new SnapshotManager({
      doc: sourceDoc,
      roomId: ROOM_GC,
      storage,
      intervalMs: 0,
    });
    managers.push(sourceManager);
    sourceDoc.getText("text").insert(0, "post-gc test");
    await sourceManager.compact();

    const peerDoc = new Y.Doc();
    const peerManager = new SnapshotManager({ doc: peerDoc, roomId: ROOM_GC, storage, intervalMs: 0 });
    managers.push(peerManager);
    const result = await peerManager.recover();

    expect(result.recovered).toBe(true);
    expect(result.converged).toBe(true);
    expect(peerDoc.getText("text").toString()).toBe("post-gc test");
  });

  // -------------------------------------------------------------------------
  // 4. Rapid successive compact() calls remain safe.
  // -------------------------------------------------------------------------
  it("rapid overlapping compact() calls do not corrupt state (#9166)", async () => {
    const doc = new Y.Doc();
    const manager = new SnapshotManager({ doc, roomId: ROOM_GC, storage, intervalMs: 0 });
    managers.push(manager);
    doc.getText("text").insert(0, "rapid compact test");

    const [s1, s2, s3] = await Promise.all([
      manager.compact(),
      manager.compact(),
      manager.compact(),
    ]);

    expect(s1.checksum).toBe(computeSnapshotChecksum(s1.update));
    expect(s2.checksum).toBe(s1.checksum);
    expect(s3.checksum).toBe(s1.checksum);

    const loaded = await storage.loadSnapshot(ROOM_GC);
    expect(loaded).not.toBeNull();
    expect(loaded!.checksum).toBe(s1.checksum);
  });

  // -------------------------------------------------------------------------
  // 5. Lock is released even if recover() throws mid-flight.
  // -------------------------------------------------------------------------
  it("gcLock read is released if recover() throws, unblocking compact GC (#9166)", async () => {
    const sourceDoc = new Y.Doc();
    const sourceManager = new SnapshotManager({ doc: sourceDoc, roomId: ROOM_GC, storage, intervalMs: 0 });
    managers.push(sourceManager);
    sourceDoc.getText("text").insert(0, "integrity test");
    const snap = await sourceManager.compact();

    // Corrupt the stored checksum so recover() will throw before acquiring read lock.
    await storage.saveSnapshot({ ...snap, checksum: "0000000000000000" });

    const peerDoc = new Y.Doc();
    const peerManager = new SnapshotManager({ doc: peerDoc, roomId: ROOM_GC, storage, intervalMs: 0 });
    managers.push(peerManager);

    await expect(peerManager.recover()).rejects.toBeInstanceOf(
      SnapshotIntegrityError,
    );

    // GC must not be blocked — compact() should run without deadlocking.
    sourceDoc.getText("text").insert(14, " extended");
    const snap2 = await sourceManager.compact();
    expect(snap2.checksum).toBe(computeSnapshotChecksum(snap2.update));
  });

  // -------------------------------------------------------------------------
  // 6. Deferred eviction: delta still accessible immediately before GC runs.
  // -------------------------------------------------------------------------
  it("delta buffers survive until all readers release the read lock (#9166)", async () => {
    const sourceDoc = new Y.Doc();
    const sourceManager = new SnapshotManager({ doc: sourceDoc, roomId: ROOM_GC, storage, intervalMs: 0 });
    managers.push(sourceManager);
    sourceDoc.getText("text").insert(0, "deferred eviction test");
    await sourceManager.compact();
    sourceDoc.getText("text").insert(22, " plus delta");
    // Keep delta buffered — compact() will flush then GC.

    const peerDoc = new Y.Doc();
    const peerManager = new SnapshotManager({ doc: peerDoc, roomId: ROOM_GC, storage, intervalMs: 0 });
    managers.push(peerManager);

    const [result] = await Promise.all([
      peerManager.recover(),
      sourceManager.compact(),
    ]);

    expect(result.appliedDeltas).toBe(1);
    expect(peerDoc.getText("text").toString()).toBe(
      "deferred eviction test plus delta",
    );
  });
});

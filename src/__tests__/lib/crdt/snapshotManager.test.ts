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

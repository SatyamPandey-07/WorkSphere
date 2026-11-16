import * as Y from "yjs";
import {
  COMPRESSION_MAGIC_HEADER,
  compressYjsUpdate,
  decompressYjsUpdate,
} from "@/lib/crdt/yjsCompression";
import {
  InMemorySnapshotStorage,
  SnapshotIntegrityError,
  SnapshotManager,
  computeSnapshotChecksum,
  decompressSnapshot,
  deserializeSnapshot,
  isCompressedPayload,
  serializeSnapshot,
  type SnapshotManagerOptions,
  type StoredSnapshot,
} from "@/lib/crdt/snapshotManager";

const ROOM = "whiteboard-compression-test-room";

describe("SnapshotManager Differential State Vector Compression (#7978)", () => {
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

  const populateRealisticDoc = (doc: Y.Doc, count = 250): void => {
    const text = doc.getText("monaco");
    const map = doc.getMap("whiteboard-nodes");
    for (let i = 0; i < count; i++) {
      text.insert(
        text.length,
        `// Function declaration step ${i}\nfunction processNode_${i}() { return { id: ${i}, active: true }; }\n`,
      );
      map.set(`node-${i}`, {
        x: i * 12,
        y: i * 8,
        width: 140,
        height: 60,
        label: `Component Block ${i}`,
        tags: ["crdt", "compression", "vector", "state"],
      });
    }
  };

  it("detects compressed payloads via magic header check", () => {
    const rawData = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(isCompressedPayload(rawData)).toBe(false);

    const withHeader = new Uint8Array([
      ...COMPRESSION_MAGIC_HEADER,
      0,
      0,
      0,
      8,
      1,
      2,
      3,
      4,
    ]);
    expect(isCompressedPayload(withHeader)).toBe(true);
  });

  it("automatically compresses snapshots exceeding threshold during compaction", async () => {
    const doc = new Y.Doc();
    const manager = makeManager(doc, {
      compressSnapshots: true,
      compressionThresholdBytes: 128,
    });

    populateRealisticDoc(doc, 100);

    const snapshot = await manager.compact();

    expect(snapshot.isCompressed).toBe(true);
    expect(snapshot.uncompressedSize).toBeDefined();
    expect(snapshot.uncompressedSize!).toBeGreaterThan(128);
    expect(snapshot.update.length).toBeLessThan(snapshot.uncompressedSize!);
    expect(isCompressedPayload(snapshot.update)).toBe(true);

    const loaded = await storage.loadSnapshot(ROOM);
    expect(loaded?.isCompressed).toBe(true);
    expect(loaded?.update.length).toBe(snapshot.update.length);
  });

  it("skips compression when payload size is below the threshold", async () => {
    const doc = new Y.Doc();
    const manager = makeManager(doc, {
      compressSnapshots: true,
      compressionThresholdBytes: 10000,
    });

    doc.getText("monaco").insert(0, "tiny update");
    const snapshot = await manager.compact();

    expect(snapshot.isCompressed).toBe(false);
    expect(isCompressedPayload(snapshot.update)).toBe(false);
  });

  it("skips compression when compressSnapshots is disabled", async () => {
    const doc = new Y.Doc();
    const manager = makeManager(doc, { compressSnapshots: false });

    populateRealisticDoc(doc, 50);
    const snapshot = await manager.compact();

    expect(snapshot.isCompressed).toBe(false);
    expect(isCompressedPayload(snapshot.update)).toBe(false);
  });

  it("transparently recovers and converges a peer from a compressed snapshot", async () => {
    const sourceDoc = new Y.Doc();
    const sourceManager = makeManager(sourceDoc, {
      compressSnapshots: true,
      compressionThresholdBytes: 64,
    });

    populateRealisticDoc(sourceDoc, 150);
    const snapshot = await sourceManager.compact();
    expect(snapshot.isCompressed).toBe(true);

    // Additional delta after baseline snapshot
    sourceDoc.getText("monaco").insert(0, "// HEADER LINE ADDED POST SNAPSHOT\n");
    await sourceManager.flushDeltas();

    const peerDoc = new Y.Doc();
    const peerManager = makeManager(peerDoc);
    const recoveryResult = await peerManager.recover();

    expect(recoveryResult.recovered).toBe(true);
    expect(recoveryResult.converged).toBe(true);
    expect(recoveryResult.appliedDeltas).toBe(1);
    expect(peerDoc.getText("monaco").toString()).toBe(
      sourceDoc.getText("monaco").toString(),
    );

    const sourceNodes = sourceDoc.getMap("whiteboard-nodes").toJSON();
    const peerNodes = peerDoc.getMap("whiteboard-nodes").toJSON();
    expect(peerNodes).toEqual(sourceNodes);
  });

  it("transparently loads decompressed snapshot via manager.loadSnapshot()", async () => {
    const doc = new Y.Doc();
    const manager = makeManager(doc, {
      compressSnapshots: true,
      compressionThresholdBytes: 64,
    });

    populateRealisticDoc(doc, 80);
    await manager.compact();

    const decompressed = await manager.loadSnapshot();
    expect(decompressed).not.toBeNull();
    expect(decompressed!.isCompressed).toBe(false);
    expect(isCompressedPayload(decompressed!.update)).toBe(false);
    expect(decompressed!.update.length).toBe(decompressed!.uncompressedSize!);
  });

  it("maintains full backward compatibility with uncompressed legacy snapshots", async () => {
    const legacyDoc = new Y.Doc();
    populateRealisticDoc(legacyDoc, 50);

    const rawUpdate = Y.encodeStateAsUpdate(legacyDoc);
    const rawVector = Y.encodeStateVector(legacyDoc);
    const rawChecksum = computeSnapshotChecksum(rawUpdate);

    // Save snapshot without compression metadata or magic headers
    const legacySnapshot: StoredSnapshot = {
      roomId: ROOM,
      update: rawUpdate,
      stateVector: rawVector,
      checksum: rawChecksum,
      opsAtSnapshot: 50,
      createdAt: Date.now(),
    };

    await storage.saveSnapshot(legacySnapshot);

    const peerDoc = new Y.Doc();
    const peerManager = makeManager(peerDoc);
    const recoveryResult = await peerManager.recover();

    expect(recoveryResult.recovered).toBe(true);
    expect(recoveryResult.converged).toBe(true);
    expect(peerDoc.getText("monaco").toString()).toBe(
      legacyDoc.getText("monaco").toString(),
    );
  });

  it("rejects corrupted compressed snapshot with SnapshotIntegrityError", async () => {
    const doc = new Y.Doc();
    const manager = makeManager(doc, {
      compressSnapshots: true,
      compressionThresholdBytes: 64,
    });

    populateRealisticDoc(doc, 60);
    const snapshot = await manager.compact();

    // Tamper with checksum
    await storage.saveSnapshot({
      ...snapshot,
      checksum: "tampered_corrupt_checksum_12345",
    });

    const peerManager = makeManager(new Y.Doc());
    await expect(peerManager.recover()).rejects.toBeInstanceOf(
      SnapshotIntegrityError,
    );
  });

  it("round-trips compressed snapshots through serialization preserving metadata", async () => {
    const doc = new Y.Doc();
    const manager = makeManager(doc, {
      compressSnapshots: true,
      compressionThresholdBytes: 64,
    });

    populateRealisticDoc(doc, 75);
    const snapshot = await manager.compact();
    expect(snapshot.isCompressed).toBe(true);

    const serialized = serializeSnapshot(snapshot);
    expect(serialized.isCompressed).toBe(true);
    expect(serialized.uncompressedSize).toBe(snapshot.uncompressedSize);

    const deserialized = deserializeSnapshot(serialized);
    expect(deserialized.isCompressed).toBe(true);
    expect(deserialized.uncompressedSize).toBe(snapshot.uncompressedSize);
    expect(isCompressedPayload(deserialized.update)).toBe(true);
    expect(Array.from(deserialized.update)).toEqual(Array.from(snapshot.update));
  });

  it("decompressSnapshot function is idempotent", () => {
    const doc = new Y.Doc();
    populateRealisticDoc(doc, 40);
    const uncompressedUpdate = Y.encodeStateAsUpdate(doc);
    const compressedUpdate = compressYjsUpdate(uncompressedUpdate);

    const snapshot: StoredSnapshot = {
      roomId: ROOM,
      update: compressedUpdate,
      stateVector: Y.encodeStateVector(doc),
      checksum: computeSnapshotChecksum(uncompressedUpdate),
      opsAtSnapshot: 40,
      createdAt: Date.now(),
      isCompressed: true,
      uncompressedSize: uncompressedUpdate.length,
    };

    const decompressedOnce = decompressSnapshot(snapshot);
    expect(decompressedOnce.isCompressed).toBe(false);
    expect(isCompressedPayload(decompressedOnce.update)).toBe(false);
    expect(Array.from(decompressedOnce.update)).toEqual(
      Array.from(uncompressedUpdate),
    );

    const decompressedTwice = decompressSnapshot(decompressedOnce);
    expect(decompressedTwice.isCompressed).toBe(false);
    expect(Array.from(decompressedTwice.update)).toEqual(
      Array.from(uncompressedUpdate),
    );
  });
});

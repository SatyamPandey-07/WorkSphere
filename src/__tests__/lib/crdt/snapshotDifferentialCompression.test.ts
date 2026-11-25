/**
 * @jest-environment jsdom
 */
import "fake-indexeddb/auto";
import * as Y from "yjs";
import {
  SnapshotManager,
  IndexedDBSnapshotStorage,
  InMemorySnapshotStorage,
  createIndexedDBSnapshotStorage,
  compressYjsGzip,
  decompressYjsGzip,
  decompressYjsGzipSync,
  isGzipCompressedPayload,
  isCompressedPayload,
  stateVectorsEqual,
  decompressSnapshot,
  computeSnapshotChecksum,
  SnapshotIntegrityError,
  type StoredSnapshot,
} from "@/lib/crdt/snapshotManager";

describe("CRDT Differential Snapshot State Vector Compression — Issue #7628", () => {
  let dbCounter = 0;
  function nextDbName(): string {
    dbCounter += 1;
    return `test-crdt-7628-${Date.now()}-${dbCounter}`;
  }

  // 1. Differential snapshot generation & State-vector comparison
  it("generates differential updates relative to previous checkpoint and detects missing changes", async () => {
    const doc = new Y.Doc();
    const map = doc.getMap<string>("canvas");
    map.set("layer-1", "background");

    const storage = new InMemorySnapshotStorage();
    const manager = new SnapshotManager({
      doc,
      roomId: "room-diff-test",
      storage,
      compressionAlgorithm: "gzip",
    });

    const snap1 = await manager.compact();
    expect(snap1).toBeDefined();
    const sv1 = Y.encodeStateVector(doc);

    // Verify state-vector comparison
    expect(stateVectorsEqual(sv1, Y.encodeStateVector(doc))).toBe(true);

    // Perform granular edits
    map.set("layer-2", "foreground");
    const sv2 = Y.encodeStateVector(doc);
    expect(stateVectorsEqual(sv1, sv2)).toBe(false);

    // Generate differential update using state vector
    const diffUpdate = Y.encodeStateAsUpdate(doc, sv1);
    const fullUpdate = Y.encodeStateAsUpdate(doc);

    // Differential update contains only missing changes (is smaller than full update)
    expect(diffUpdate.byteLength).toBeLessThan(fullUpdate.byteLength);

    // Generate and persist next checkpoint
    const snap2 = await manager.compact();
    expect(snap2).toBeDefined();

    // Verify document can be rehydrated from snap2 with complete fidelity
    const rehydrated = new Y.Doc();
    const decomp = decompressSnapshot(snap2);
    Y.applyUpdate(rehydrated, decomp.update);
    expect(rehydrated.getMap("canvas").get("layer-1")).toBe("background");
    expect(rehydrated.getMap("canvas").get("layer-2")).toBe("foreground");

    await manager.destroy();
  });

  // 2. Correct handling of multiple clients & Preservation of concurrent updates
  it("preserves concurrent CRDT updates across multiple clients through compaction", async () => {
    const doc1 = new Y.Doc({ clientID: 1001 });
    const doc2 = new Y.Doc({ clientID: 2002 });

    const strokes1 = doc1.getMap<any>("strokes");
    const strokes2 = doc2.getMap<any>("strokes");

    strokes1.set("stroke-initial", { color: "blue", points: [0, 0] });
    Y.applyUpdate(doc2, Y.encodeStateAsUpdate(doc1));

    const storage = new InMemorySnapshotStorage();
    const manager1 = new SnapshotManager({
      doc: doc1,
      roomId: "room-concurrent-test",
      storage,
      compressionAlgorithm: "gzip",
    });

    // Checkpoint 1
    await manager1.compact();

    // Concurrent edits
    strokes1.set("stroke-client1", { color: "red", points: [10, 10] });
    strokes2.set("stroke-client2", { color: "green", points: [20, 20] });

    // Sync doc2 -> doc1
    Y.applyUpdate(doc1, Y.encodeStateAsUpdate(doc2));

    // Checkpoint 2 with both client updates integrated
    const snap2 = await manager1.compact();

    // Target doc rehydrated from snap2
    const targetDoc = new Y.Doc({ clientID: 3003 });
    const decomp = decompressSnapshot(snap2);
    Y.applyUpdate(targetDoc, decomp.update);

    const targetStrokes = targetDoc.getMap<any>("strokes");
    expect(targetStrokes.get("stroke-initial")).toEqual({ color: "blue", points: [0, 0] });
    expect(targetStrokes.get("stroke-client1")).toEqual({ color: "red", points: [10, 10] });
    expect(targetStrokes.get("stroke-client2")).toEqual({ color: "green", points: [20, 20] });

    // Verify 100% state equivalence
    expect(stateVectorsEqual(Y.encodeStateVector(targetDoc), Y.encodeStateVector(doc1))).toBe(true);

    await manager1.destroy();
  });

  // 3. Redundant transaction-frame pruning & Safe failure behavior
  it("prunes redundant historical transaction frames after checkpoint persistence and preserves newer updates", async () => {
    const doc = new Y.Doc();
    const map = doc.getMap<string>("shapes");
    const dbName = nextDbName();
    const storage = createIndexedDBSnapshotStorage(dbName);

    const manager = new SnapshotManager({
      doc,
      roomId: "room-prune-test",
      storage,
      compressionAlgorithm: "gzip",
    });

    // Append 5 transactional edits
    for (let i = 1; i <= 5; i++) {
      map.set(`s-${i}`, `val-${i}`);
    }

    // Flush deltas
    await manager.flushDeltas();
    let deltas = await storage.listDeltas("room-prune-test");
    expect(deltas.length).toBe(5);

    // Compact checkpoint: should persist checkpoint and prune deltas 1..5
    await manager.compact();

    deltas = await storage.listDeltas("room-prune-test");
    expect(deltas.length).toBe(0);

    // Add 2 newer updates after checkpoint
    for (let i = 6; i <= 7; i++) {
      map.set(`s-${i}`, `val-${i}`);
    }
    await manager.flushDeltas();

    deltas = await storage.listDeltas("room-prune-test");
    expect(deltas.length).toBe(2);
    expect(deltas[0].seq).toBe(6);
    expect(deltas[1].seq).toBe(7);

    // Verify no pruning occurs if checkpoint persistence fails
    const failingStorage: typeof storage = Object.create(storage);
    failingStorage.saveSnapshot = jest.fn().mockRejectedValue(new Error("IndexedDB quota exceeded"));

    const manager2 = new SnapshotManager({
      doc,
      roomId: "room-prune-test",
      storage: failingStorage,
      compressionAlgorithm: "gzip",
    });

    map.set("s-8", "val-8");
    await manager2.flushDeltas();
    const deltasBeforeFail = await storage.listDeltas("room-prune-test");
    expect(deltasBeforeFail.length).toBe(3); // 6, 7, 8

    await expect(manager2.compact()).rejects.toThrow("IndexedDB quota exceeded");

    // All deltas 6, 7, 8 must be preserved!
    const deltasAfterFail = await storage.listDeltas("room-prune-test");
    expect(deltasAfterFail.length).toBe(3);

    await manager.destroy();
    await manager2.destroy();
    if (storage instanceof IndexedDBSnapshotStorage) {
      await storage.close();
    }
  });

  // 4. Gzip compression, decompression, and round-trip fidelity
  it("compresses and decompresses binary buffers using gzip preserving full fidelity", async () => {
    const rawData = new Uint8Array(1024);
    for (let i = 0; i < rawData.length; i++) {
      rawData[i] = (i * 37 + 13) % 256;
    }

    const compressed = await compressYjsGzip(rawData);
    expect(isGzipCompressedPayload(compressed)).toBe(true);
    expect(isCompressedPayload(compressed)).toBe(true);

    // Avoid double compression
    const doubleCompressed = await compressYjsGzip(compressed);
    expect(doubleCompressed).toBe(compressed);

    // Decompress async
    const decompressedAsync = await decompressYjsGzip(compressed);
    expect(Buffer.from(decompressedAsync).equals(Buffer.from(rawData))).toBe(true);

    // Decompress sync
    const decompressedSync = decompressYjsGzipSync(compressed);
    expect(Buffer.from(decompressedSync).equals(Buffer.from(rawData))).toBe(true);
  });

  // 5. Backward compatibility with uncompressed snapshots
  it("re-hydrates transparently from existing uncompressed snapshots", async () => {
    const doc = new Y.Doc();
    const text = doc.getText("notes");
    text.insert(0, "Uncompressed legacy snapshot text");

    const uncompressedUpdate = Y.encodeStateAsUpdate(doc);
    const uncompressedStateVector = Y.encodeStateVector(doc);

    const legacySnapshot: StoredSnapshot = {
      roomId: "legacy-room",
      update: uncompressedUpdate,
      stateVector: uncompressedStateVector,
      checksum: computeSnapshotChecksum(uncompressedUpdate),
      opsAtSnapshot: 10,
      createdAt: Date.now(),
      isCompressed: false,
    };

    const storage = new InMemorySnapshotStorage();
    await storage.saveSnapshot(legacySnapshot);

    const targetDoc = new Y.Doc();
    const manager = new SnapshotManager({
      doc: targetDoc,
      roomId: "legacy-room",
      storage,
      compressionAlgorithm: "gzip",
    });

    const recovery = await manager.recover();
    expect(recovery.recovered).toBe(true);
    expect(recovery.converged).toBe(true);
    expect(targetDoc.getText("notes").toString()).toBe("Uncompressed legacy snapshot text");

    await manager.destroy();
  });

  // 6. Safe fallback when CompressionStream is unavailable
  it("safely falls back when native CompressionStream is unavailable", async () => {
    const originalCS = global.CompressionStream;
    const originalDS = global.DecompressionStream;
    try {
      // Simulate environment where CompressionStream is unavailable
      // @ts-ignore
      delete global.CompressionStream;
      // @ts-ignore
      delete global.DecompressionStream;

      const raw = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      const compressed = await compressYjsGzip(raw);
      expect(isGzipCompressedPayload(compressed)).toBe(true);

      const decompressed = await decompressYjsGzip(compressed);
      expect(Buffer.from(decompressed).equals(Buffer.from(raw))).toBe(true);
    } finally {
      global.CompressionStream = originalCS;
      global.DecompressionStream = originalDS;
    }
  });

  // 7. Acceptance Test: Storage reduction on representative long session fixture (>60%)
  it("achieves >60% storage reduction on a representative long whiteboard session fixture", async () => {
    const doc = new Y.Doc();
    const shapes = doc.getMap<any>("whiteboard-shapes");
    const paths = doc.getText("whiteboard-paths");

    const rawUpdates: Uint8Array[] = [];
    doc.on("update", (u) => rawUpdates.push(u));

    // Long collaborative session simulation: 600 granular transaction frames
    for (let i = 0; i < 600; i++) {
      doc.transact(() => {
        shapes.set(`shape-${i % 60}`, {
          id: `shape-${i % 60}`,
          type: i % 2 === 0 ? "stroke" : "rectangle",
          x: (i * 7.5) % 800,
          y: (i * 12.3) % 600,
          width: 120,
          height: 80,
          color: i % 3 === 0 ? "#ff0000" : "#00ff00",
          points: [i, i * 2, i * 3, i * 4],
          updatedAt: 1700000000 + i,
        });
        paths.insert(paths.length, `M ${i} ${i * 2} L ${i * 3} ${i * 4} `);
      });
    }

    const rawTotalBytes = rawUpdates.reduce((acc, u) => acc + u.byteLength, 0);

    const storage = new InMemorySnapshotStorage();
    const manager = new SnapshotManager({
      doc,
      roomId: "acceptance-long-session-room",
      storage,
      compressionAlgorithm: "gzip",
      compressionThresholdBytes: 64,
    });

    const snapshot = await manager.compact();
    const compressedBytes = snapshot.update.byteLength;

    const reductionRatio = (1 - compressedBytes / rawTotalBytes) * 100;

    console.log(`[Storage Acceptance Test] Raw updates size: ${rawTotalBytes} bytes`);
    console.log(`[Storage Acceptance Test] Compressed snapshot size: ${compressedBytes} bytes`);
    console.log(`[Storage Acceptance Test] Measured reduction: ${reductionRatio.toFixed(2)}%`);

    // Target: More than 60% storage reduction on representative long session fixture
    expect(reductionRatio).toBeGreaterThan(60);

    await manager.destroy();
  });

  // 8. Acceptance Test: 100% Document-state fidelity test
  it("re-hydrates a fresh Yjs document with 100% document-state fidelity", async () => {
    const originalDoc = new Y.Doc({ clientID: 4001 });
    const shapes = originalDoc.getMap<any>("canvas-shapes");
    const notes = originalDoc.getText("canvas-notes");

    for (let i = 0; i < 200; i++) {
      shapes.set(`shape-${i}`, {
        index: i,
        label: `Shape Element ${i}`,
        coordinates: [i * 10, i * 20],
        active: i % 2 === 0,
      });
      notes.insert(notes.length, `Note entry ${i}\n`);
    }

    const storage = new InMemorySnapshotStorage();
    const manager = new SnapshotManager({
      doc: originalDoc,
      roomId: "fidelity-test-room",
      storage,
      compressionAlgorithm: "gzip",
    });

    await manager.compact();

    // Rehydrate brand new document from storage
    const targetDoc = new Y.Doc({ clientID: 5002 });
    const targetManager = new SnapshotManager({
      doc: targetDoc,
      roomId: "fidelity-test-room",
      storage,
    });

    const recovery = await targetManager.recover();
    expect(recovery.recovered).toBe(true);
    expect(recovery.converged).toBe(true);

    // Compare 100% document state
    expect(targetDoc.getText("canvas-notes").toString()).toBe(originalDoc.getText("canvas-notes").toString());
    expect(targetDoc.getMap("canvas-shapes").toJSON()).toEqual(originalDoc.getMap("canvas-shapes").toJSON());

    const origSv = Y.encodeStateVector(originalDoc);
    const targetSv = Y.encodeStateVector(targetDoc);
    expect(stateVectorsEqual(origSv, targetSv)).toBe(true);

    await manager.destroy();
    await targetManager.destroy();
  });
});

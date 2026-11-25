/**
 * @jest-environment jsdom
 */
import "fake-indexeddb/auto";

import * as Y from "yjs";

jest.mock("@/lib/redis", () => ({
  redis: null,
  getRedis: () => null,
}));

import {
  CanvasChangeJournal,
  CanvasSnapshotIntegrityError,
  DEFAULT_MAX_COMPACTION_BYTES,
  DEFAULT_MAX_JOURNAL_RECORDS,
  NomadCanvasProvider,
  computeChecksum,
  stateVectorsEqual,
  type CanvasSnapshot,
  type CompactionConfig,
} from "@/lib/crdt/canvasProvider";

let dbCounter = 0;

function nextDbName(): string {
  dbCounter += 1;
  return `worksphere-canvas-compaction-test-${Date.now()}-${dbCounter}`;
}

interface Harness {
  provider: NomadCanvasProvider;
  journalDbName: string;
  send: jest.Mock;
}

function createProvider(
  overrides: Partial<CompactionConfig> = {},
  journalDbName: string = nextDbName(),
): Harness {
  const send = jest.fn();
  const provider = new NomadCanvasProvider(`room-${journalDbName}`, {
    transport: { send, isConnected: () => false },
    journalDbName,
    checkpointIntervalMs: 60 * 60 * 1000,
    maxOperations: 1_000_000,
    enableAutoCompaction: false,
    ...overrides,
  });
  return { provider, journalDbName, send };
}

function applySnapshot(update: Uint8Array): Y.Doc {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, update);
  return doc;
}

describe("canvas journal snapshot compaction (#7741)", () => {
  const providers: NomadCanvasProvider[] = [];

  afterEach(() => {
    for (const provider of providers.splice(0)) {
      provider.destroy();
    }
    jest.restoreAllMocks();
  });

  const track = (harness: Harness): Harness => {
    providers.push(harness.provider);
    return harness;
  };

  it("exports the documented 500-record and 5 MB thresholds", () => {
    expect(DEFAULT_MAX_JOURNAL_RECORDS).toBe(500);
    expect(DEFAULT_MAX_COMPACTION_BYTES).toBe(5 * 1024 * 1024);
  });

  it("compacts automatically once the journal exceeds 500 raw records", async () => {
    const harness = track(
      createProvider({ enableAutoCompaction: true, maxJournalRecords: 500 }),
    );
    const { provider } = harness;
    const strokes = provider.doc.getMap<number>("strokes");

    for (let i = 0; i < 520; i++) {
      strokes.set(`stroke-${i}`, i);
    }

    // Encoding and pruning must be deferred, never run inside the draw loop.
    expect(provider.lastCompaction).toBeNull();

    await provider.flushPendingWrites();
    await provider.waitForCompaction();

    const compaction = provider.lastCompaction;
    expect(compaction).not.toBeNull();
    expect(compaction!.deletedRecords).toBeGreaterThanOrEqual(500);
    expect(compaction!.snapshot.opsAtSnapshot).toBeGreaterThanOrEqual(500);

    const stats = await provider.getJournalStats();
    expect(stats).not.toBeNull();
    expect(stats!.hasSnapshot).toBe(true);
    expect(stats!.recordCount).toBeLessThan(100);
  });

  it("compacts when raw records exceed the 5 MB byte budget", async () => {
    const maxCompactionBytes = 64 * 1024;
    const harness = track(
      createProvider({
        enableAutoCompaction: true,
        maxJournalRecords: 1_000_000,
        maxCompactionBytes,
      }),
    );
    const { provider } = harness;
    const blobs = provider.doc.getMap<string>("blobs");

    const payload = "x".repeat(512);
    for (let i = 0; i < 200; i++) {
      blobs.set(`blob-${i}`, `${payload}${i}`);
    }

    await provider.flushPendingWrites();
    await provider.waitForCompaction();

    const stats = await provider.getJournalStats();
    expect(stats!.hasSnapshot).toBe(true);
    expect(provider.lastCompaction).not.toBeNull();
    expect(provider.lastCompaction!.reclaimedBytes).toBeGreaterThan(0);
    expect(stats!.recordCount).toBeLessThan(50);
  });

  it("stores the snapshot and prunes superseded records atomically", async () => {
    const journalDbName = nextDbName();
    const journal = new CanvasChangeJournal(journalDbName);
    const room = `room-${journalDbName}`;
    const doc = new Y.Doc();
    const updates: Uint8Array[] = [];
    doc.on("update", (update: Uint8Array) => updates.push(update));

    const points = doc.getArray<number>("points");
    for (let i = 0; i < 25; i++) {
      points.push([i, i * 2]);
    }
    for (const update of updates) {
      await journal.append(room, update);
    }

    const before = await journal.getStats(room);
    expect(before.recordCount).toBe(updates.length);
    expect(before.hasSnapshot).toBe(false);

    const update = Y.encodeStateAsUpdate(doc);
    const snapshot: CanvasSnapshot = {
      roomName: room,
      update: Array.from(update),
      stateVector: Array.from(Y.encodeStateVector(doc)),
      checksum: computeChecksum(update),
      opsAtSnapshot: before.recordCount,
      createdAt: Date.now(),
    };

    // A boundary that covers only the first five records must leave the rest.
    const partial = await journal.compact(snapshot, 5);
    expect(partial.deletedRecords).toBe(5);
    expect((await journal.listPending(room)).length).toBe(updates.length - 5);
    expect(await journal.loadSnapshot(room)).not.toBeNull();

    const result = await journal.compact(snapshot, before.latestSeq);
    expect(result.deletedRecords).toBe(updates.length - 5);
    expect(result.reclaimedBytes).toBeGreaterThan(0);

    const after = await journal.getStats(room);
    expect(after.recordCount).toBe(0);
    expect(after.hasSnapshot).toBe(true);
    expect(after.snapshotChecksum).toBe(snapshot.checksum);

    const stored = await journal.loadSnapshot(room);
    expect(stored).not.toBeNull();
    expect(computeChecksum(new Uint8Array(stored!.update))).toBe(
      snapshot.checksum,
    );
    expect(
      stateVectorsEqual(
        Y.encodeStateVector(applySnapshot(new Uint8Array(stored!.update))),
        new Uint8Array(snapshot.stateVector),
      ),
    ).toBe(true);

    await journal.close();
  });

  it("preserves state-vector integrity and round-trip fidelity through compaction", async () => {
    const harness = track(createProvider({ enableAutoCompaction: false }));
    const { provider, journalDbName } = harness;
    const strokes = provider.doc.getArray<number>("strokes");
    for (let i = 0; i < 120; i++) {
      strokes.push([i, i * 2, i * 3]);
    }

    await provider.flushPendingWrites();

    const vectorBefore = Y.encodeStateVector(provider.doc);
    const checksumBefore = provider.getDocumentChecksum();

    const result = await provider.compactJournal();
    expect(result).not.toBeNull();
    expect(result!.deletedRecords).toBe(120);
    expect(result!.reclaimedBytes).toBeGreaterThan(0);

    // Live document must be byte-identical: compaction re-encodes, never rewrites.
    expect(provider.getDocumentChecksum()).toBe(checksumBefore);
    expect(
      stateVectorsEqual(Y.encodeStateVector(provider.doc), vectorBefore),
    ).toBe(true);

    // The persisted baseline must rebuild the exact same document.
    const journal = new CanvasChangeJournal(journalDbName);
    const stored = await journal.loadSnapshot(provider.roomName);
    expect(stored).not.toBeNull();
    expect(stored!.checksum).toBe(
      computeChecksum(Y.encodeStateAsUpdate(provider.doc)),
    );

    const rebuilt = applySnapshot(new Uint8Array(stored!.update));
    expect(rebuilt.getArray<number>("strokes").toArray()).toEqual(
      strokes.toArray(),
    );
    expect(stateVectorsEqual(Y.encodeStateVector(rebuilt), vectorBefore)).toBe(
      true,
    );

    await journal.close();
  });

  it("retains journal records written after the snapshot", async () => {
    const journalDbName = nextDbName();
    const harness = track(
      createProvider({ enableAutoCompaction: false }, journalDbName),
    );
    const { provider } = harness;
    const strokes = provider.doc.getArray<number>("strokes");

    for (let i = 0; i < 15; i++) strokes.push([i]);
    await provider.flushPendingWrites();
    await provider.compactJournal();

    for (let i = 15; i < 25; i++) strokes.push([i]);
    await provider.flushPendingWrites();

    const stats = await provider.getJournalStats();
    expect(stats!.recordCount).toBe(10);

    // A joining peer restores the baseline, then replays the surviving blocks.
    const joining = track(
      createProvider(
        {
          enableAutoCompaction: false,
          enableJournal: true,
          transport: undefined,
        },
        journalDbName,
      ),
    );
    const restored = await joining.provider.restoreFromJournal();

    expect(restored.restored).toBe(true);
    expect(restored.appliedBlocks).toBe(10);
    expect(
      stateVectorsEqual(
        Y.encodeStateVector(joining.provider.doc),
        Y.encodeStateVector(provider.doc),
      ),
    ).toBe(true);
    expect(joining.provider.doc.getArray<number>("strokes").toArray()).toEqual(
      strokes.toArray(),
    );
  });

  it("rejects a corrupt stored snapshot instead of applying it", async () => {
    const harness = track(createProvider({ enableAutoCompaction: false }));
    const { provider, journalDbName } = harness;
    provider.doc.getMap<number>("strokes").set("a", 1);
    await provider.flushPendingWrites();
    await provider.compactJournal();

    const journal = new CanvasChangeJournal(journalDbName);
    const stored = await journal.loadSnapshot(provider.roomName);
    expect(stored).not.toBeNull();

    await journal.saveSnapshot({
      ...stored!,
      checksum: "deadbeefdeadbeef",
    });

    await expect(provider.restoreFromJournal()).rejects.toBeInstanceOf(
      CanvasSnapshotIntegrityError,
    );
    await journal.close();
  });

  it("refuses to prune records when the stored baseline is corrupt", async () => {
    const harness = track(createProvider({ enableAutoCompaction: false }));
    const { provider, journalDbName } = harness;
    provider.doc.getArray<number>("strokes").push([1, 2, 3]);
    await provider.flushPendingWrites();

    const journal = new CanvasChangeJournal(journalDbName);
    const update = Y.encodeStateAsUpdate(provider.doc);
    await journal.saveSnapshot({
      roomName: provider.roomName,
      update: Array.from(update),
      stateVector: Array.from(Y.encodeStateVector(provider.doc)),
      checksum: "0000000000000000",
      opsAtSnapshot: 1,
      createdAt: Date.now(),
    });

    const before = await journal.getStats(provider.roomName);
    await expect(provider.compactJournal()).rejects.toBeInstanceOf(
      CanvasSnapshotIntegrityError,
    );
    const after = await journal.getStats(provider.roomName);

    expect(after.recordCount).toBe(before.recordCount);
    expect(after.recordCount).toBeGreaterThan(0);
    await journal.close();
  });

  it("hydrates a cold-started provider before compacting its journal", async () => {
    const journalDbName = nextDbName();
    const writer = track(
      createProvider({ enableAutoCompaction: false }, journalDbName),
    );
    const strokes = writer.provider.doc.getArray<number>("strokes");
    for (let i = 0; i < 30; i++) strokes.push([i]);
    await writer.provider.flushPendingWrites();

    const coldStart = track(
      createProvider(
        {
          enableAutoCompaction: false,
          enableJournal: true,
          transport: undefined,
        },
        journalDbName,
      ),
    );
    expect(coldStart.provider.doc.getArray("strokes").length).toBe(0);

    const result = await coldStart.provider.compactJournal();
    expect(result).not.toBeNull();

    // The compactor must reconstruct the journal before pruning it.
    expect(
      stateVectorsEqual(
        Y.encodeStateVector(coldStart.provider.doc),
        Y.encodeStateVector(writer.provider.doc),
      ),
    ).toBe(true);
    expect(
      coldStart.provider.doc.getArray<number>("strokes").toArray(),
    ).toEqual(strokes.toArray());

    const stats = await coldStart.provider.getJournalStats();
    expect(stats!.recordCount).toBe(0);
    expect(stats!.hasSnapshot).toBe(true);
  });

  it("reduces the IndexedDB footprint by more than 70% for long sessions", async () => {
    const harness = track(
      createProvider({
        enableAutoCompaction: false,
        maxJournalRecords: 1_000_000,
      }),
    );
    const { provider } = harness;
    const cursor = provider.doc.getMap<string>("cursor");

    for (let i = 0; i < 400; i++) {
      cursor.set("position", String(i).padStart(64, "0"));
    }
    await provider.flushPendingWrites();

    const before = await provider.getJournalStats();
    expect(before!.recordCount).toBe(400);
    expect(before!.totalBytes).toBeGreaterThan(0);

    await provider.compactJournal();

    const after = await provider.getJournalStats();
    expect(after!.recordCount).toBe(0);
    expect(after!.hasSnapshot).toBe(true);
    expect(after!.snapshotBytes).toBeGreaterThan(0);

    const reduction = 1 - after!.snapshotBytes / before!.totalBytes;
    expect(reduction).toBeGreaterThan(0.7);
  });

  it("notifies the caller after a successful compaction", async () => {
    const onCompacted = jest.fn();
    const harness = track(
      createProvider({ enableAutoCompaction: false, onCompacted }),
    );
    harness.provider.doc.getArray<number>("strokes").push([1, 2, 3]);
    await harness.provider.flushPendingWrites();

    await harness.provider.compactJournal();

    expect(onCompacted).toHaveBeenCalledTimes(1);
    expect(harness.provider.lastCompaction).not.toBeNull();
  });
});

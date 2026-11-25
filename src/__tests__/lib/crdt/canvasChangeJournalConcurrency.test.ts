/**
 * @jest-environment node
 */
import "fake-indexeddb/auto";
import {
  CanvasChangeJournal,
  computeChecksum,
  type CanvasSnapshot,
} from "@/lib/crdt/canvasProvider";

describe("CanvasChangeJournal write serialization (#7775)", () => {
  const databaseNames: string[] = [];
  const journals: CanvasChangeJournal[] = [];

  function createJournal(): CanvasChangeJournal {
    const dbName = `worksphere-crdt-mutex-${Date.now()}-${Math.random()}`;
    databaseNames.push(dbName);
    const journal = new CanvasChangeJournal(dbName);
    journals.push(journal);
    return journal;
  }

  afterEach(async () => {
    await Promise.all(journals.map((journal) => journal.close()));
    journals.length = 0;
    for (const name of databaseNames.splice(0)) {
      indexedDB.deleteDatabase(name);
    }
  });

  it("assigns unique monotonic sequence numbers across journal instances", async () => {
    const left = createJournal();
    const right = new CanvasChangeJournal(
      (left as unknown as { dbName: string }).dbName,
    );
    journals.push(right);

    const writes = await Promise.all(
      Array.from({ length: 40 }, (_, index) =>
        (index % 2 === 0 ? left : right).append(
          "room-1",
          new Uint8Array([index + 1]),
        ),
      ),
    );

    const sequences = writes.map((write) => write?.seq).sort((a, b) => a! - b!);
    expect(sequences).toEqual(Array.from({ length: 40 }, (_, index) => index + 1));
    expect(await left.size("room-1")).toBe(40);
  });

  it("serializes compaction with incoming appends and preserves updates beyond the snapshot boundary", async () => {
    const journal = createJournal();
    const dbName = (journal as unknown as { dbName: string }).dbName;
    const otherInstance = new CanvasChangeJournal(dbName);
    journals.push(otherInstance);

    const originals = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        journal.append("room-2", new Uint8Array([index + 1])),
      ),
    );
    expect(originals.every(Boolean)).toBe(true);

    const snapshotBytes = new Uint8Array([9, 9, 9]);
    const snapshot: CanvasSnapshot = {
      roomName: "room-2",
      update: Array.from(snapshotBytes),
      stateVector: [],
      checksum: computeChecksum(snapshotBytes),
      opsAtSnapshot: originals.length,
      createdAt: Date.now(),
    };

    const compactPromise = journal.compact(snapshot, 12);
    const incomingPromise = Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        otherInstance.append("room-2", new Uint8Array([100 + index])),
      ),
    );

    const compacted = await compactPromise;
    const incoming = await incomingPromise;
    expect(compacted.deletedRecords).toBe(12);
    expect(incoming.every(Boolean)).toBe(true);
    expect(incoming.map((block) => block?.seq)).toEqual(
      Array.from({ length: 8 }, (_, index) => index + 13),
    );
    expect((await journal.listPending("room-2")).map((block) => block.seq)).toEqual(
      Array.from({ length: 8 }, (_, index) => index + 13),
    );
    expect((await journal.loadSnapshot("room-2"))?.checksum).toBe(snapshot.checksum);
  });
});

import * as Y from "yjs";
import { openDB } from "idb";
import "fake-indexeddb/auto";
import {
  CanvasChangeJournal,
  NomadCanvasProvider,
  computeChecksum,
  type CanvasTransport,
} from "@/lib/crdt/canvasProvider";

let dbCounter = 0;
function uniqueDbName(): string {
  dbCounter += 1;
  return `worksphere-journal-test-${Date.now()}-${dbCounter}`;
}

function makeTransport(initial = false) {
  const sent: Uint8Array[] = [];
  const state = { connected: initial };
  const transport: CanvasTransport = {
    send: (update) => sent.push(update),
    isConnected: () => state.connected,
  };
  return { transport, sent, state };
}

async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMs = 2000,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return false;
}

describe("CRDT offline change-journal replay buffer (#7528)", () => {
  it("persists queued blocks across a simulated browser restart", async () => {
    const dbName = uniqueDbName();
    const journal = new CanvasChangeJournal(dbName);

    const block = await journal.append("room-persist", new Uint8Array([1, 2, 3]));
    expect(block).not.toBeNull();
    expect(block?.seq).toBe(1);

    // Simulate a page reload: drop the cached connection and reopen.
    journal.resetCache();
    const reopened = new CanvasChangeJournal(dbName);

    const pending = await reopened.listPending("room-persist");
    expect(pending).toHaveLength(1);
    expect(pending[0].seq).toBe(1);
    expect(pending[0].update).toEqual([1, 2, 3]);
    expect(pending[0].checksum).toBe(computeChecksum(new Uint8Array([1, 2, 3])));
  });

  it("rejects empty updates and assigns monotonic sequence numbers", async () => {
    const journal = new CanvasChangeJournal(uniqueDbName());

    expect(await journal.append("room-seq", new Uint8Array([]))).toBeNull();
    expect(await journal.append("   ", new Uint8Array([9]))).toBeNull();

    const a = await journal.append("room-seq", new Uint8Array([1]));
    const b = await journal.append("room-seq", new Uint8Array([2]));
    const c = await journal.append("room-seq", new Uint8Array([3]));

    expect([a?.seq, b?.seq, c?.seq]).toEqual([1, 2, 3]);
  });

  it("queues offline edits and re-streams them in order on reconnect", async () => {
    const dbName = uniqueDbName();
    const { transport, sent, state } = makeTransport(false);

    const provider = new NomadCanvasProvider("room-offline", {
      transport,
      journalDbName: dbName,
      enableJournal: true,
    });

    const strokes = provider.doc.getArray("strokes");
    for (let i = 0; i < 3; i++) {
      strokes.push([{ id: i }]);
    }

    const queued = await waitFor(
      async () => (await provider.pendingJournalCount()) === 3,
    );
    expect(queued).toBe(true);
    expect(sent).toHaveLength(0);

    // Simulate a browser restart while still offline.
    provider.destroy();
    const resumed = new NomadCanvasProvider("room-offline", {
      transport,
      journalDbName: dbName,
      enableJournal: true,
    });
    expect(await resumed.pendingJournalCount()).toBe(3);

    // Reconnect and replay.
    state.connected = true;
    const result = await resumed.replayJournal();

    expect(result.replayed).toBe(3);
    expect(sent).toHaveLength(3);
    expect(await resumed.pendingJournalCount()).toBe(0);

    // The replayed blocks reconstruct the original document in order.
    const rebuilt = new Y.Doc();
    for (const update of sent) {
      Y.applyUpdate(rebuilt, update);
    }
    expect(rebuilt.getArray("strokes").length).toBe(3);

    resumed.destroy();
    rebuilt.destroy();
  });

  it("triggers replay automatically when the transport reconnects", async () => {
    const { transport, sent, state } = makeTransport(false);
    const provider = new NomadCanvasProvider("room-auto", {
      transport,
      journalDbName: uniqueDbName(),
      enableJournal: true,
    });

    provider.doc.getArray("strokes").push([{ id: "auto" }]);
    await waitFor(async () => (await provider.pendingJournalCount()) === 1);

    state.connected = true;
    provider.setConnected(true);

    const drained = await waitFor(
      async () => (await provider.pendingJournalCount()) === 0,
    );
    expect(drained).toBe(true);
    expect(sent).toHaveLength(1);

    provider.destroy();
  });

  it("validates checksum convergence between local and remote documents", () => {
    const provider = new NomadCanvasProvider("room-checksum");
    provider.doc.getArray("strokes").push([{ id: "a" }]);

    const remote = new Y.Doc();
    Y.applyUpdate(remote, provider.compactState());
    const remoteChecksum = computeChecksum(Y.encodeStateAsUpdate(remote));

    expect(provider.getDocumentChecksum()).toBe(remoteChecksum);
    expect(provider.verifyConvergence(remoteChecksum)).toBe(true);
    expect(provider.verifyConvergence("deadbeefdeadbeef")).toBe(false);

    provider.destroy();
    remote.destroy();
  });

  it("drops corrupted journal blocks instead of streaming them", async () => {
    const dbName = uniqueDbName();
    const journal = new CanvasChangeJournal(dbName);
    await journal.append("room-corrupt", new Uint8Array([1, 2, 3, 4]));

    // Tamper with the stored bytes while leaving the checksum untouched.
    const db = await openDB(dbName, 1);
    const blocks = await db.getAll("journal");
    blocks[0].update = [9, 9, 9, 9];
    await db.put("journal", blocks[0]);

    const { transport, sent, state } = makeTransport(true);
    state.connected = true;
    const provider = new NomadCanvasProvider("room-corrupt", {
      transport,
      journalDbName: dbName,
      enableJournal: true,
    });

    const result = await provider.replayJournal();

    expect(result.replayed).toBe(0);
    expect(sent).toHaveLength(0);
    expect(await provider.pendingJournalCount()).toBe(0);

    provider.destroy();
  });
});

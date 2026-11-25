import * as Y from "yjs";
import {
  CANVAS_ELEMENTS_MAP,
  CANVAS_TOMBSTONES_MAP,
  CrdtDeltaSyncSession,
  NomadCanvasProvider,
  TombstoneCanvasState,
} from "@/lib/crdt/canvasProvider";

describe("CRDT Tombstone Resurrection Prevention (#7492)", () => {
  it("prevents concurrent attribute mutations from resurrecting a deleted element across partitioned peers", () => {
    const peerADoc = new Y.Doc();
    const peerBDoc = new Y.Doc();

    const peerAState = new TombstoneCanvasState(peerADoc);
    const peerBState = new TombstoneCanvasState(peerBDoc);

    // 1. Peer A creates a vector object and syncs initial state to Peer B
    peerAState.upsertElement({
      id: "vec-1",
      type: "rect",
      x: 100,
      y: 120,
      width: 140,
      height: 90,
      color: "#3b82f6",
      label: "Architecture Box",
    });

    Y.applyUpdate(peerBDoc, Y.encodeStateAsUpdate(peerADoc));
    expect(peerBState.getElement("vec-1")?.color).toBe("#3b82f6");

    // 2. Network partition: Peer A deletes `vec-1` while Peer B concurrently
    //    mutates its color property over a high-latency link.
    const svABeforePartition = Y.encodeStateVector(peerADoc);
    const svBBeforePartition = Y.encodeStateVector(peerBDoc);

    peerAState.deleteElement("vec-1");
    expect(peerAState.isTombstoned("vec-1")).toBe(true);
    expect(peerAState.getActiveElements()).toHaveLength(0);

    // Peer B has not yet received Peer A's delete, so its local edit succeeds locally
    const updatedLocallyOnB = peerBState.updateElementAttributes("vec-1", {
      color: "#ef4444",
      x: 180,
    });
    expect(updatedLocallyOnB).toBe(true);

    // 3. Partition heals: exchange deltas in both orders
    const deltaFromA = Y.encodeStateAsUpdate(peerADoc, svBBeforePartition);
    const deltaFromB = Y.encodeStateAsUpdate(peerBDoc, svABeforePartition);

    // Peer A receives Peer B's late color mutation AFTER Peer A deleted the item
    Y.applyUpdate(peerADoc, deltaFromB);
    // Peer B receives Peer A's deletion AFTER Peer B edited the color
    Y.applyUpdate(peerBDoc, deltaFromA);

    // Neither peer may resurrect `vec-1` as a ghost element
    expect(peerAState.isTombstoned("vec-1")).toBe(true);
    expect(peerBState.isTombstoned("vec-1")).toBe(true);
    expect(peerAState.getElement("vec-1")).toBeNull();
    expect(peerBState.getElement("vec-1")).toBeNull();
    expect(peerAState.getActiveElements()).toEqual([]);
    expect(peerBState.getActiveElements()).toEqual([]);
  });

  it("discards direct attribute updates and upserts on items already marked deleted: true", () => {
    const doc = new Y.Doc();
    const state = new TombstoneCanvasState(doc);

    state.upsertElement({
      id: "vec-deleted",
      type: "circle",
      x: 40,
      y: 60,
      color: "#10b981",
    });

    state.deleteElement("vec-deleted");

    // Subsequent attribute mutations or upserts must be silently discarded
    expect(
      state.updateElementAttributes("vec-deleted", { color: "#f59e0b" }),
    ).toBe(false);
    expect(
      state.upsertElement({
        id: "vec-deleted",
        type: "circle",
        x: 99,
        y: 99,
        color: "#f59e0b",
      }),
    ).toBe(false);

    expect(state.getActiveElements()).toHaveLength(0);
    expect(doc.getMap(CANVAS_ELEMENTS_MAP).has("vec-deleted")).toBe(false);
    expect(doc.getMap(CANVAS_TOMBSTONES_MAP).get("vec-deleted")).toMatchObject({
      id: "vec-deleted",
      deleted: true,
    });
  });

  it("allows re-applying mutations only after an explicit undo/restore operation", () => {
    const doc = new Y.Doc();
    const state = new TombstoneCanvasState(doc);

    state.upsertElement({
      id: "vec-restore",
      type: "rect",
      x: 10,
      y: 20,
      color: "#3b82f6",
    });
    state.deleteElement("vec-restore");
    expect(state.getElement("vec-restore")).toBeNull();

    // Explicit restore clears the tombstone
    expect(state.restoreElement("vec-restore")).toBe(true);
    expect(state.isTombstoned("vec-restore")).toBe(false);
    expect(state.getElement("vec-restore")?.color).toBe("#3b82f6");

    // Mutations now succeed again
    expect(
      state.updateElementAttributes("vec-restore", { color: "#8b5cf6" }),
    ).toBe(true);
    expect(state.getElement("vec-restore")?.color).toBe("#8b5cf6");
  });

  it("converges cleanly between partitioned CrdtDeltaSyncSession peers with state vector handshake", () => {
    const providerA = new NomadCanvasProvider("room-tombstone-sync", {
      enableJournal: false,
      checkpointIntervalMs: 0,
    });
    const providerB = new NomadCanvasProvider("room-tombstone-sync", {
      enableJournal: false,
      checkpointIntervalMs: 0,
    });

    const wireAtoB: Uint8Array[] = [];
    const wireBtoA: Uint8Array[] = [];

    const sessionA = new CrdtDeltaSyncSession({
      doc: providerA.doc,
      peerId: "peer-a",
      sendFrame: (frame) => wireAtoB.push(frame),
    });
    const sessionB = new CrdtDeltaSyncSession({
      doc: providerB.doc,
      peerId: "peer-b",
      sendFrame: (frame) => wireBtoA.push(frame),
    });

    try {
      // Seed shared element
      providerA.canvasState.upsertElement({
        id: "sticky-1",
        type: "sticky",
        x: 20,
        y: 30,
        color: "#f59e0b",
        label: "Sprint Goal",
      });
      Y.applyUpdate(providerB.doc, Y.encodeStateAsUpdate(providerA.doc));

      // Concurrent delete on A and color edit on B while partitioned
      providerA.canvasState.deleteElement("sticky-1");
      providerB.canvasState.updateElementAttributes("sticky-1", {
        color: "#ef4444",
      });

      // Handshake & delta exchange via CrdtDeltaSyncSession
      sessionA.initiateStateVectorHandshake();
      while (wireAtoB.length > 0) {
        sessionB.receiveFrame(wireAtoB.shift()!);
      }
      while (wireBtoA.length > 0) {
        sessionA.receiveFrame(wireBtoA.shift()!);
      }

      sessionB.initiateStateVectorHandshake();
      while (wireBtoA.length > 0) {
        sessionA.receiveFrame(wireBtoA.shift()!);
      }
      while (wireAtoB.length > 0) {
        sessionB.receiveFrame(wireAtoB.shift()!);
      }

      expect(providerA.canvasState.getActiveElements()).toHaveLength(0);
      expect(providerB.canvasState.getActiveElements()).toHaveLength(0);
      expect(providerA.verifyConvergence(providerB.getDocumentChecksum())).toBe(
        true,
      );
    } finally {
      providerA.destroy();
      providerB.destroy();
    }
  });
});
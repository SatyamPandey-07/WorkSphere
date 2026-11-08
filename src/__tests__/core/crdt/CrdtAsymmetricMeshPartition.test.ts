/**
 * CrdtAsymmetricMeshPartition.test.ts
 * Tests for resolving split-brain state divergence under asymmetric WebRTC mesh network partitions (#5889).
 * Verifies transitive vector clock causality tracking, multi-hop peer message relaying,
 * missing parent operation replay, and 3-node deterministic state convergence upon partition healing.
 */

import {
  CrdtDocument,
  CrdtOperation,
  PeerMessage,
} from "@/core/crdt/CrdtDocument";

describe("CrdtDocument - Asymmetric WebRTC Mesh Partition & Transitive Reconciliation (#5889)", () => {
  describe("Tracking Transitive Vector Clock Dependencies Across Multi-Hop Peer Messages", () => {
    it("tracks hopCount and relayedBy trail across multi-hop peer relay path (A -> B -> C)", () => {
      const docA = new CrdtDocument("node-A");
      const docB = new CrdtDocument("node-B");
      const docC = new CrdtDocument("node-C");

      // Node A creates an element
      docA.applyLocalOperation({
        id: "box-alpha",
        type: "DRAW_STROKE",
        nodeId: "node-A",
        timestamp: 1000,
        payload: { path: "M0,0 L10,10", color: "#10b981" },
      });

      // Hop 1: Node A sends to Bridge Node B
      const syncMsgToB = docA.createTransitiveSyncMessage(
        "node-B",
        docB.getStateVector(),
      );
      expect(syncMsgToB.operations).toHaveLength(1);
      expect(syncMsgToB.operations![0].hopCount).toBe(1);
      expect(syncMsgToB.operations![0].relayedBy).toEqual(["node-A"]);

      docB.receivePeerMessage(syncMsgToB);
      expect(docB.getState().elements["box-alpha"]).toBeDefined();

      // Hop 2: Bridge Node B forwards Node A's operation to Node C
      const syncMsgToC = docB.createTransitiveSyncMessage(
        "node-C",
        docC.getStateVector(),
      );
      expect(syncMsgToC.operations).toHaveLength(1);
      expect(syncMsgToC.operations![0].id).toBe("box-alpha");
      expect(syncMsgToC.operations![0].hopCount).toBe(2);
      expect(syncMsgToC.operations![0].relayedBy).toEqual(["node-A", "node-B"]);

      const receiveRes = docC.receivePeerMessage(syncMsgToC);
      expect(receiveRes.appliedCount).toBe(1);
      expect(docC.getState().elements["box-alpha"]).toBeDefined();
      expect(docC.getState().elements["box-alpha"].payload.color).toBe(
        "#10b981",
      );

      // Verify transitive vector clock was incorporated at Node C
      expect(docC.hasInStateVector("node-A", 1)).toBe(true);
    });

    it("records and updates peer state vectors upon receiving peer messages", () => {
      const docB = new CrdtDocument("node-B");

      const stateVectorA = { "node-A": 4, "node-B": 1 };
      const msgFromA: PeerMessage = {
        type: "STATE_VECTOR",
        sourceNodeId: "node-A",
        stateVector: stateVectorA,
        timestamp: Date.now(),
      };

      docB.receivePeerMessage(msgFromA);
      expect(docB.getPeerStateVector("node-A")).toEqual(stateVectorA);
      expect(docB.getAllPeerStateVectors()["node-A"]).toEqual(stateVectorA);
    });

    it("getMissingOperations accurately isolates unseen operations based on remote state vector", () => {
      const doc = new CrdtDocument("node-bridge");

      doc.applyLocalOperation({
        id: "shape-1",
        type: "DRAW_STROKE",
        nodeId: "node-bridge",
        timestamp: 100,
        payload: { path: "M0,0 L5,5" },
      });
      doc.applyLocalOperation({
        id: "shape-2",
        type: "DRAW_STROKE",
        nodeId: "node-bridge",
        timestamp: 200,
        payload: { path: "M5,5 L10,10" },
      });

      // Remote peer has seen up to tick 1 of node-bridge
      const remoteVector = { "node-bridge": 1 };
      const missing = doc.getMissingOperations(remoteVector);

      expect(missing).toHaveLength(1);
      expect(missing[0].id).toBe("shape-2");
    });
  });

  describe("Replaying Missing Parent Operations Before Applying Child Edits", () => {
    it("buffers child edit in pendingOperations when parent is missing, then automatically replays when parent arrives", () => {
      const docC = new CrdtDocument("node-C");

      // Child edit that references parent "card-main" which docC does not have
      const childOp: CrdtOperation = {
        id: "card-main-title",
        type: "UPDATE_TEXT",
        nodeId: "node-B",
        timestamp: 2000,
        vectorClock: { "node-A": 1, "node-B": 2 },
        parentOpId: "card-main",
        dependencies: { "node-A": 1 },
        payload: { text: "Updated Child Title" },
      };

      // Merge child edit directly before parent arrives
      const mergedChild = docC.mergeRemoteOperation(childOp);
      expect(mergedChild).toBe(false);

      // Child should be held in pending queue and not yet active in elements
      expect(docC.getPendingOperations()).toHaveLength(1);
      expect(docC.getPendingOperations()[0].id).toBe("card-main-title");
      expect(docC.getState().elements["card-main-title"]).toBeUndefined();

      // Now parent operation arrives
      const parentOp: CrdtOperation = {
        id: "card-main",
        type: "ADD_TEXT",
        nodeId: "node-A",
        timestamp: 1000,
        vectorClock: { "node-A": 1 },
        payload: { text: "Original Parent Container" },
      };

      const mergedParent = docC.mergeRemoteOperation(parentOp);
      expect(mergedParent).toBe(true);

      // Parent must be applied and child must be automatically replayed and applied!
      expect(docC.getState().elements["card-main"]).toBeDefined();
      expect(docC.getState().elements["card-main-title"]).toBeDefined();
      expect(docC.getState().elements["card-main-title"].payload.text).toBe(
        "Updated Child Title",
      );
      expect(docC.getPendingOperations()).toHaveLength(0);
    });

    it("replays missing parent operation from history log if parent was previously registered", () => {
      const doc = new CrdtDocument("node-editor");

      // Apply parent operation
      doc.applyLocalOperation({
        id: "parent-container",
        type: "ADD_TEXT",
        nodeId: "node-editor",
        timestamp: 100,
        payload: { text: "Container" },
      });

      // Simulate container being temporarily replaced or modified in elements
      const childOp: CrdtOperation = {
        id: "nested-badge",
        type: "UPDATE_TEXT",
        nodeId: "remote-peer",
        timestamp: 500,
        vectorClock: { "node-editor": 1, "remote-peer": 1 },
        parentOpId: "parent-container",
        payload: { text: "Verified Badge" },
      };

      expect(doc.isOperationCausallyReady(childOp)).toBe(true);
      const replayed = doc.replayMissingParent(childOp);
      expect(replayed).toBe(true);
    });

    it("unrolls and replays chained multi-generation dependencies in causal order (grandchild -> child -> parent)", () => {
      const doc = new CrdtDocument("node-replica");

      const parentOp: CrdtOperation = {
        id: "tree-root",
        type: "ADD_TEXT",
        nodeId: "author-1",
        timestamp: 100,
        vectorClock: { "author-1": 1 },
        payload: { label: "Root" },
      };

      const childOp: CrdtOperation = {
        id: "tree-branch",
        type: "ADD_TEXT",
        nodeId: "author-2",
        timestamp: 200,
        vectorClock: { "author-1": 1, "author-2": 1 },
        parentOpId: "tree-root",
        dependencies: { "author-1": 1 },
        payload: { label: "Branch" },
      };

      const grandChildOp: CrdtOperation = {
        id: "tree-leaf",
        type: "ADD_TEXT",
        nodeId: "author-3",
        timestamp: 300,
        vectorClock: { "author-1": 1, "author-2": 1, "author-3": 1 },
        parentOpId: "tree-branch",
        dependencies: { "author-2": 1 },
        payload: { label: "Leaf" },
      };

      // Deliver in reverse order: grandchild first, then child, then parent
      doc.mergeRemoteOperation(grandChildOp);
      doc.mergeRemoteOperation(childOp);

      expect(doc.getPendingOperations()).toHaveLength(2);
      expect(doc.getState().elements["tree-root"]).toBeUndefined();
      expect(doc.getState().elements["tree-branch"]).toBeUndefined();
      expect(doc.getState().elements["tree-leaf"]).toBeUndefined();

      // When root parent arrives, both child and grandchild must cascade-replay
      doc.mergeRemoteOperation(parentOp);

      expect(doc.getState().elements["tree-root"]).toBeDefined();
      expect(doc.getState().elements["tree-branch"]).toBeDefined();
      expect(doc.getState().elements["tree-leaf"]).toBeDefined();
      expect(doc.getPendingOperations()).toHaveLength(0);
    });
  });

  describe("Automated 3-Node Network Partition & Convergence After Healing", () => {
    it("demonstrates complete 3-node state convergence after asymmetric partition healing", () => {
      // -------------------------------------------------------------
      // 1. Initial State: All 3 nodes start in sync with a shared board
      // -------------------------------------------------------------
      const docA = new CrdtDocument("node-A");
      const docB = new CrdtDocument("node-B");
      const docC = new CrdtDocument("node-C");

      const initOp = docA.applyLocalOperation({
        id: "canvas-header",
        type: "ADD_TEXT",
        nodeId: "node-A",
        timestamp: 1000,
        payload: { text: "Sprint 42 Architecture Whiteboard" },
      });
      docB.mergeRemoteOperation(initOp);
      docC.mergeRemoteOperation(initOp);

      // Verify all 3 start in identical state
      expect(docA.getElements()).toHaveLength(1);
      expect(docB.getElements()).toHaveLength(1);
      expect(docC.getElements()).toHaveLength(1);

      // -------------------------------------------------------------
      // 2. Asymmetric Network Partition Active:
      //    Node A can talk to Node B.
      //    Node B can talk to Node C.
      //    Node A CANNOT talk to Node C directly.
      // -------------------------------------------------------------

      // Node A creates edits locally
      docA.applyLocalOperation({
        id: "sticky-note-A",
        type: "ADD_TEXT",
        nodeId: "node-A",
        timestamp: 1100,
        payload: { text: "Node A: Service Mesh Config" },
      });
      docA.applyLocalOperation({
        id: "canvas-header",
        type: "UPDATE_TEXT",
        nodeId: "node-A",
        timestamp: 1200,
        payload: { text: "Sprint 42 - Node A Revisions" },
      });

      // Node C creates concurrent edits locally while partitioned from Node A
      docC.applyLocalOperation({
        id: "sticky-note-C",
        type: "ADD_TEXT",
        nodeId: "node-C",
        timestamp: 1150,
        payload: { text: "Node C: Database Sharding Plan" },
      });
      docC.applyLocalOperation({
        id: "canvas-header",
        type: "UPDATE_TEXT",
        nodeId: "node-C",
        timestamp: 1300,
        payload: { text: "Sprint 42 - Node C Revisions" },
      });

      // Node B (bridge node) also makes an edit
      docB.applyLocalOperation({
        id: "bridge-banner",
        type: "DRAW_STROKE",
        nodeId: "node-B",
        timestamp: 1120,
        payload: { path: "M10,10 L100,100", strokeWidth: 4 },
      });

      // -------------------------------------------------------------
      // 3. Multi-Hop Forwarding Through Bridge Node B
      // -------------------------------------------------------------
      // (a) Node A syncs with Bridge Node B
      const syncAtoB = docA.createTransitiveSyncMessage(
        "node-B",
        docB.getStateVector(),
      );
      docB.receivePeerMessage(syncAtoB);

      // (b) Bridge Node B transitively forwards Node A's ops + its own ops to Node C
      const syncBtoC = docB.createTransitiveSyncMessage(
        "node-C",
        docC.getStateVector(),
      );
      // Verify Node B forwards operations from Node A with hopCount = 2
      const opAInRelay = syncBtoC.operations?.find(
        (op) => op.id === "sticky-note-A",
      );
      expect(opAInRelay).toBeDefined();
      expect(opAInRelay!.hopCount).toBe(2);
      expect(opAInRelay!.relayedBy).toContain("node-B");

      docC.receivePeerMessage(syncBtoC);

      // (c) Node C syncs with Bridge Node B
      const syncCtoB = docC.createTransitiveSyncMessage(
        "node-B",
        docB.getStateVector(),
      );
      docB.receivePeerMessage(syncCtoB);

      // (d) Bridge Node B transitively forwards Node C's ops to Node A
      const syncBtoA = docB.createTransitiveSyncMessage(
        "node-A",
        docA.getStateVector(),
      );
      const opCInRelay = syncBtoA.operations?.find(
        (op) => op.id === "sticky-note-C",
      );
      expect(opCInRelay).toBeDefined();
      expect(opCInRelay!.hopCount).toBe(2);
      expect(opCInRelay!.relayedBy).toContain("node-B");

      docA.receivePeerMessage(syncBtoA);

      // -------------------------------------------------------------
      // 4. Partition Heals: Direct communication restored between Node A and Node C
      // -------------------------------------------------------------
      const directSyncAtoC = docA.createTransitiveSyncMessage(
        "node-C",
        docC.getStateVector(),
      );
      docC.receivePeerMessage(directSyncAtoC);

      const directSyncCtoA = docC.createTransitiveSyncMessage(
        "node-A",
        docA.getStateVector(),
      );
      docA.receivePeerMessage(directSyncCtoA);

      // Reconcile remaining bridge state
      const finalSyncB = docB.createTransitiveSyncMessage(
        "node-A",
        docA.getStateVector(),
      );
      docA.receivePeerMessage(finalSyncB);

      // -------------------------------------------------------------
      // 5. Verification: Complete 3-Node Deterministic Convergence
      // -------------------------------------------------------------
      // All 3 nodes must have all 4 elements
      expect(docA.getState().elements["sticky-note-A"]).toBeDefined();
      expect(docA.getState().elements["sticky-note-C"]).toBeDefined();
      expect(docA.getState().elements["bridge-banner"]).toBeDefined();
      expect(docA.getState().elements["canvas-header"]).toBeDefined();

      expect(docB.getState().elements["sticky-note-A"]).toBeDefined();
      expect(docB.getState().elements["sticky-note-C"]).toBeDefined();
      expect(docB.getState().elements["bridge-banner"]).toBeDefined();
      expect(docB.getState().elements["canvas-header"]).toBeDefined();

      expect(docC.getState().elements["sticky-note-A"]).toBeDefined();
      expect(docC.getState().elements["sticky-note-C"]).toBeDefined();
      expect(docC.getState().elements["bridge-banner"]).toBeDefined();
      expect(docC.getState().elements["canvas-header"]).toBeDefined();

      // Conflicting element "canvas-header" must resolve deterministically to the identical winner across all 3 nodes
      const headerA = docA.getState().elements["canvas-header"].payload.text;
      const headerB = docB.getState().elements["canvas-header"].payload.text;
      const headerC = docC.getState().elements["canvas-header"].payload.text;

      expect(headerA).toBe(headerB);
      expect(headerB).toBe(headerC);

      // Number of active elements must be identical
      expect(docA.getElements()).toHaveLength(4);
      expect(docB.getElements()).toHaveLength(4);
      expect(docC.getElements()).toHaveLength(4);

      // States across all 3 nodes are completely unified - zero split-brain divergence!
      expect(docA.getState().elements).toEqual(docB.getState().elements);
      expect(docB.getState().elements).toEqual(docC.getState().elements);
    });
  });
});

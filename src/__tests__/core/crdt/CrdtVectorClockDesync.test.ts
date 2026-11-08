/**
 * CrdtVectorClockDesync.test.ts
 * Tests for resolving vector clock desynchronization during rapid offline reconnects (#5277).
 * Verifies Lamport timestamp ordering, skipped tick reconciliation, and deterministic state convergence.
 */

import { CrdtDocument, CrdtOperation } from "@/core/crdt/CrdtDocument";
import { CrdtVectorClock } from "@/core/crdt/CrdtVectorClock";

describe("CrdtVectorClock - Lamport Timestamp Ordering & Skipped Ticks (#5277)", () => {
  describe("Lamport Logical Time Calculation", () => {
    it("calculates getLamportTime as the sum of all clock ticks across nodes", () => {
      const clock = new CrdtVectorClock({
        "node-alpha": 5,
        "node-beta": 12,
        "node-gamma": 3,
      });

      expect(clock.getLamportTime()).toBe(20);
      expect(
        CrdtVectorClock.getLamportTime({
          "node-alpha": 5,
          "node-beta": 12,
          "node-gamma": 3,
        }),
      ).toBe(20);
    });

    it("handles empty and single-node clocks", () => {
      const emptyClock = new CrdtVectorClock();
      expect(emptyClock.getLamportTime()).toBe(0);

      const singleClock = new CrdtVectorClock({ "solo-node": 42 });
      expect(singleClock.getLamportTime()).toBe(42);
    });
  });

  describe("Vector Clock Comparison with Lamport Ordering", () => {
    it("returns 'equal' for identical vector clocks", () => {
      const clockA = new CrdtVectorClock({ "peer-1": 4, "peer-2": 8 });
      expect(clockA.compare({ "peer-1": 4, "peer-2": 8 })).toBe("equal");
    });

    it("returns 'before' and 'after' for strictly dominated vector clocks", () => {
      const clockA = new CrdtVectorClock({ "peer-1": 2, "peer-2": 3 });
      const clockB = new CrdtVectorClock({ "peer-1": 5, "peer-2": 7 });

      expect(clockA.compare(clockB.getClock())).toBe("before");
      expect(clockB.compare(clockA.getClock())).toBe("after");
    });

    it("orders concurrent clocks with skipped ticks strictly by Lamport timestamp", () => {
      // Peer 1 was offline and made 15 rapid edits (clock jumped to 16, peer-2 is at 1) -> Lamport = 17
      // Peer 2 was online and made 2 edits (peer-1 is at 1, peer-2 jumped to 3) -> Lamport = 4
      const offlineHighFreqClock = new CrdtVectorClock({
        "peer-1": 16,
        "peer-2": 1,
      });
      const onlineLowFreqClock = new CrdtVectorClock({
        "peer-1": 1,
        "peer-2": 3,
      });

      // offlineHighFreqClock has higher Lamport time (17 > 4), so it is 'after'
      expect(offlineHighFreqClock.compare(onlineLowFreqClock.getClock())).toBe(
        "after",
      );
      // onlineLowFreqClock has lower Lamport time (4 < 17), so it is 'before'
      expect(onlineLowFreqClock.compare(offlineHighFreqClock.getClock())).toBe(
        "before",
      );
    });

    it("returns 'concurrent' when concurrent clocks have identical Lamport timestamps", () => {
      const clockA = new CrdtVectorClock({ "peer-A": 4, "peer-B": 1 }); // Lamport = 5
      const clockB = new CrdtVectorClock({ "peer-A": 1, "peer-B": 4 }); // Lamport = 5

      expect(clockA.compare(clockB.getClock())).toBe("concurrent");
      expect(clockB.compare(clockA.getClock())).toBe("concurrent");
    });
  });
});

describe("CrdtDocument - Rapid Offline Reconnect Convergence (#5277)", () => {
  describe("High-Frequency Offline Edits vs Low-Frequency Concurrent Edits", () => {
    it("converges to the higher Lamport edit even when author has lower lexicographical nodeId", () => {
      // client-001 has lower lexicographical nodeId than client-999
      const docA = new CrdtDocument("client-001");
      const docB = new CrdtDocument("client-999");

      // Shared initial state: docA creates header
      const initOp = docA.applyLocalOperation({
        id: "doc-title",
        type: "ADD_TEXT",
        nodeId: "client-001",
        timestamp: 1000,
        payload: { text: "Sprint Retrospective" },
      });
      docB.mergeRemoteOperation(initOp);

      // --- Network Disconnect / Offline Partition ---
      // client-001 performs 15 high-frequency local edits while offline on doc-title
      let latestOpA: CrdtOperation = initOp;
      for (let i = 1; i <= 15; i++) {
        latestOpA = docA.applyLocalOperation({
          id: "doc-title",
          type: "UPDATE_TEXT",
          nodeId: "client-001",
          timestamp: 1000 + i * 100,
          payload: { text: `Sprint Retrospective - Revision ${i}` },
        });
      }

      // client-999 performs 2 local edits while offline
      let latestOpB: CrdtOperation = initOp;
      for (let j = 1; j <= 2; j++) {
        latestOpB = docB.applyLocalOperation({
          id: "doc-title",
          type: "UPDATE_TEXT",
          nodeId: "client-999",
          timestamp: 1000 + j * 150,
          payload: { text: `Conflicting Title from B #${j}` },
        });
      }

      // --- Rapid Reconnect: Exchanging Latest Operations (Skipped Ticks) ---
      // client-001's clock: { "client-001": 16 } (Lamport: 16)
      // client-999's clock: { "client-001": 1, "client-999": 2 } (Lamport: 3)
      const mergedAtB = docB.mergeRemoteOperation(latestOpA);
      const mergedAtA = docA.mergeRemoteOperation(latestOpB);

      // Client B accepts client-001's latestOpA because Lamport 16 > 3
      expect(mergedAtB).toBe(true);
      // Client A rejects client-999's latestOpB because Lamport 3 < 16
      expect(mergedAtA).toBe(false);

      // Both replicas must converge deterministically to Revision 15
      expect(docA.getElements()[0].payload.text).toBe(
        "Sprint Retrospective - Revision 15",
      );
      expect(docB.getElements()[0].payload.text).toBe(
        "Sprint Retrospective - Revision 15",
      );
      expect(docA.getState().elements["doc-title"]).toEqual(
        docB.getState().elements["doc-title"],
      );
    });

    it("converges symmetrically when operations are exchanged in reverse arrival order", () => {
      const docA = new CrdtDocument("peer-alpha");
      const docB = new CrdtDocument("peer-beta");

      // Peer Alpha offline edits
      const opAlpha = docA.applyLocalOperation({
        id: "shared-note",
        type: "ADD_TEXT",
        nodeId: "peer-alpha",
        timestamp: 500,
        payload: { content: "Alpha Note" },
      });
      // Alpha advances 5 ticks
      let finalAlpha = opAlpha;
      for (let i = 1; i <= 5; i++) {
        finalAlpha = docA.applyLocalOperation({
          id: "shared-note",
          type: "UPDATE_TEXT",
          nodeId: "peer-alpha",
          timestamp: 500 + i,
          payload: { content: `Alpha Note v${i}` },
        });
      }

      // Peer Beta offline edit (1 tick)
      const opBeta = docB.applyLocalOperation({
        id: "shared-note",
        type: "ADD_TEXT",
        nodeId: "peer-beta",
        timestamp: 502,
        payload: { content: "Beta Note Initial" },
      });

      // Peer Beta merges Alpha's operation first
      docB.mergeRemoteOperation(finalAlpha);
      // Peer Alpha merges Beta's operation second
      docA.mergeRemoteOperation(opBeta);

      expect(docA.getElements()[0].payload.content).toBe("Alpha Note v5");
      expect(docB.getElements()[0].payload.content).toBe("Alpha Note v5");
      expect(docA.getState().elements["shared-note"]).toEqual(
        docB.getState().elements["shared-note"],
      );
    });
  });

  describe("Reconciliation Without Dropping Intermediate States", () => {
    it("reconciles batch of multi-element offline edits via mergeRemoteOperations without dropping states", () => {
      const docA = new CrdtDocument("mobile-client");
      const docB = new CrdtDocument("desktop-client");

      // Mobile client makes edits to three separate items while offline
      const op1 = docA.applyLocalOperation({
        id: "item-1",
        type: "ADD_TEXT",
        nodeId: "mobile-client",
        timestamp: 100,
        payload: { title: "Item 1" },
      });
      const op2 = docA.applyLocalOperation({
        id: "item-2",
        type: "DRAW_STROKE",
        nodeId: "mobile-client",
        timestamp: 110,
        payload: { points: [0, 0, 10, 10] },
      });
      const op3 = docA.applyLocalOperation({
        id: "item-3",
        type: "ADD_TEXT",
        nodeId: "mobile-client",
        timestamp: 120,
        payload: { title: "Item 3" },
      });

      // Desktop client concurrently adds item-4
      const op4 = docB.applyLocalOperation({
        id: "item-4",
        type: "ADD_TEXT",
        nodeId: "desktop-client",
        timestamp: 115,
        payload: { title: "Item 4 Desktop" },
      });

      // Mobile reconnects and sends the entire batch of operations to Desktop
      const results = docB.mergeRemoteOperations([op1, op2, op3]);
      expect(results).toEqual([true, true, true]);

      // Desktop sends item-4 to Mobile
      docA.mergeRemoteOperation(op4);

      // Neither replica drops any items: all 4 items exist on both replicas
      expect(docA.getElements()).toHaveLength(4);
      expect(docB.getElements()).toHaveLength(4);
      expect(docA.getState().elements).toEqual(docB.getState().elements);
    });

    it("deterministically resolves equal Lamport timestamps via nodeId tie-breaking", () => {
      const doc1 = new CrdtDocument("node-A");
      const doc2 = new CrdtDocument("node-B");

      // Both nodes create the exact same element with 1 local tick concurrently
      const opA = doc1.applyLocalOperation({
        id: "tie-break-item",
        type: "ADD_TEXT",
        nodeId: "node-A",
        timestamp: 1000,
        payload: { author: "A" },
      });

      const opB = doc2.applyLocalOperation({
        id: "tie-break-item",
        type: "ADD_TEXT",
        nodeId: "node-B",
        timestamp: 1000,
        payload: { author: "B" },
      });

      // Both clocks have Lamport = 1
      expect(opA.vectorClock["node-A"]).toBe(1);
      expect(opB.vectorClock["node-B"]).toBe(1);

      // Exchange operations
      doc1.mergeRemoteOperation(opB);
      doc2.mergeRemoteOperation(opA);

      // node-B > node-A lexicographically, so node-B's edit wins on both
      expect(doc1.getElements()[0].payload.author).toBe("B");
      expect(doc2.getElements()[0].payload.author).toBe("B");
      expect(doc1.getState().elements["tie-break-item"]).toEqual(
        doc2.getState().elements["tie-break-item"],
      );
    });

    it("rejects duplicate operations idempotently without state mutation or clock drift", () => {
      const doc = new CrdtDocument("main-replica");

      const op = doc.applyLocalOperation({
        id: "canvas-shape",
        type: "DRAW_STROKE",
        nodeId: "main-replica",
        timestamp: 100,
        payload: { color: "purple" },
      });

      const clockBefore = doc.getState().vectorClock;

      // Resending identical operation should be rejected idempotently
      const appliedAgain = doc.mergeRemoteOperation(op);
      expect(appliedAgain).toBe(false);

      // State and clock remain unaltered
      expect(doc.getState().vectorClock).toEqual(clockBefore);
      expect(doc.getElements()).toHaveLength(1);
    });
  });
});

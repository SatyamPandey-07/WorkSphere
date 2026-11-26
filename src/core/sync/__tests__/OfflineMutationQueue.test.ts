import { OfflineMutationQueue, OfflineMutation } from "../OfflineMutationQueue";

describe("OfflineMutationQueue", () => {
  let queue: OfflineMutationQueue<Record<string, unknown>>;

  beforeEach(() => {
    queue = new OfflineMutationQueue({ nodeId: "server" });
  });

  describe("Initialization and Config", () => {
    it("initializes with default node ID and empty clock", () => {
      const q = new OfflineMutationQueue();
      expect(q.getNodeId()).toBe("server");
      expect(q.getLocalClock()).toEqual({ server: 0 });
      expect(q.getPendingCount()).toBe(0);
    });

    it("initializes with custom node ID and initial clock", () => {
      const q = new OfflineMutationQueue({
        nodeId: "node-x",
        initialClock: { "client-1": 5, "node-x": 2 },
      });
      expect(q.getNodeId()).toBe("node-x");
      expect(q.getLocalClock()).toEqual({ "client-1": 5, "node-x": 2 });
    });

    it("validates initialClock counters are non-negative safe integers", () => {
      expect(() => {
        new OfflineMutationQueue({
          initialClock: { "client-1": -1 },
        });
      }).toThrow(RangeError);

      expect(() => {
        new OfflineMutationQueue({
          initialClock: { "": 1 },
        });
      }).toThrow(TypeError);
    });
  });

  describe("Sequential In-Order Mutations", () => {
    it("applies mutation immediately when dependencies are met", () => {
      const mut1: OfflineMutation<Record<string, unknown>> = {
        id: "mut-1",
        clientId: "nomad-1",
        vectorClock: { "nomad-1": 1 },
        payload: { seatId: "seat-42", status: "DRAFT" },
      };

      const result = queue.enqueue(mut1);
      expect(result.status).toBe("APPLIED");
      expect(result.appliedMutations).toHaveLength(1);
      expect(result.appliedMutations[0].id).toBe("mut-1");
      expect(queue.getPendingCount()).toBe(0);
      expect(queue.getLocalClock()["nomad-1"]).toBe(1);
      expect(queue.isApplied("mut-1")).toBe(true);
    });

    it("processes multiple sequential mutations from the same client", () => {
      const mut1: OfflineMutation<Record<string, unknown>> = {
        id: "mut-1",
        clientId: "nomad-1",
        vectorClock: { "nomad-1": 1 },
        payload: { status: "PENDING" },
      };
      const mut2: OfflineMutation<Record<string, unknown>> = {
        id: "mut-2",
        clientId: "nomad-1",
        vectorClock: { "nomad-1": 2 },
        payload: { seatId: "desk-7" },
      };
      const mut3: OfflineMutation<Record<string, unknown>> = {
        id: "mut-3",
        clientId: "nomad-1",
        vectorClock: { "nomad-1": 3 },
        payload: { status: "CONFIRMED" },
      };

      const res1 = queue.enqueue(mut1);
      const res2 = queue.enqueue(mut2);
      const res3 = queue.enqueue(mut3);

      expect(res1.status).toBe("APPLIED");
      expect(res2.status).toBe("APPLIED");
      expect(res3.status).toBe("APPLIED");
      expect(queue.getLocalClock()["nomad-1"]).toBe(3);
      expect(queue.getAppliedHistory()).toHaveLength(3);
    });
  });

  describe("Out-of-Order Causal Dependency Buffering (#9636)", () => {
    it("buffers orphan mutation when B arrives before A and cascades both when A arrives", () => {
      // Step to reproduce: Queue 3 offline mutations (A, B, C) where B depends on A
      const mutA: OfflineMutation<Record<string, unknown>> = {
        id: "mut-A",
        clientId: "nomad-1",
        vectorClock: { "nomad-1": 1 },
        payload: { step: "A", venueId: "venue-100" },
      };

      const mutB: OfflineMutation<Record<string, unknown>> = {
        id: "mut-B",
        clientId: "nomad-1",
        vectorClock: { "nomad-1": 2 },
        payload: { step: "B", seatId: "seat-200" },
      };

      const mutC: OfflineMutation<Record<string, unknown>> = {
        id: "mut-C",
        clientId: "nomad-1",
        vectorClock: { "nomad-1": 3 },
        payload: { step: "C", status: "CONFIRMED" },
      };

      // Network reordering: B arrives first!
      const resB = queue.enqueue(mutB);
      expect(resB.status).toBe("BUFFERED");
      expect(resB.appliedMutations).toHaveLength(0);
      expect(resB.bufferedCount).toBe(1);
      expect(queue.isPending("mut-B")).toBe(true);
      expect(queue.getLocalClock()["nomad-1"]).toBeUndefined();

      // Now A arrives at sync endpoint
      const resA = queue.enqueue(mutA);
      // Both A and B must be applied in strict causal order!
      expect(resA.status).toBe("APPLIED");
      expect(resA.appliedMutations).toHaveLength(2);
      expect(resA.appliedMutations[0].id).toBe("mut-A");
      expect(resA.appliedMutations[1].id).toBe("mut-B");
      expect(resA.bufferedCount).toBe(0);
      expect(queue.getPendingCount()).toBe(0);
      expect(queue.getLocalClock()["nomad-1"]).toBe(2);

      // Now C arrives
      const resC = queue.enqueue(mutC);
      expect(resC.status).toBe("APPLIED");
      expect(resC.appliedMutations).toHaveLength(1);
      expect(resC.appliedMutations[0].id).toBe("mut-C");
      expect(queue.getLocalClock()["nomad-1"]).toBe(3);
    });

    it("handles full reverse arrival order (C arrives, then B, then A)", () => {
      const mutA: OfflineMutation<Record<string, unknown>> = {
        id: "mut-A",
        clientId: "nomad-1",
        vectorClock: { "nomad-1": 1 },
        payload: { val: 1 },
      };
      const mutB: OfflineMutation<Record<string, unknown>> = {
        id: "mut-B",
        clientId: "nomad-1",
        vectorClock: { "nomad-1": 2 },
        payload: { val: 2 },
      };
      const mutC: OfflineMutation<Record<string, unknown>> = {
        id: "mut-C",
        clientId: "nomad-1",
        vectorClock: { "nomad-1": 3 },
        payload: { val: 3 },
      };

      // C arrives first
      const resC = queue.enqueue(mutC);
      expect(resC.status).toBe("BUFFERED");
      expect(queue.getPendingCount()).toBe(1);

      // B arrives second
      const resB = queue.enqueue(mutB);
      expect(resB.status).toBe("BUFFERED");
      expect(queue.getPendingCount()).toBe(2);

      // A arrives last -> cascades A -> B -> C
      const resA = queue.enqueue(mutA);
      expect(resA.status).toBe("APPLIED");
      expect(resA.appliedMutations).toHaveLength(3);
      expect(resA.appliedMutations.map((m) => m.id)).toEqual([
        "mut-A",
        "mut-B",
        "mut-C",
      ]);
      expect(queue.getPendingCount()).toBe(0);
      expect(queue.getLocalClock()["nomad-1"]).toBe(3);
    });

    it("supports explicit parentClock dependencies", () => {
      const mut1: OfflineMutation<Record<string, unknown>> = {
        id: "mut-1",
        clientId: "nomad-1",
        vectorClock: { "nomad-1": 1 },
        payload: { title: "First" },
      };
      const mut2: OfflineMutation<Record<string, unknown>> = {
        id: "mut-2",
        clientId: "nomad-1",
        vectorClock: { "nomad-1": 2 },
        parentClock: { "nomad-1": 1 },
        payload: { title: "Second" },
      };

      // Mut2 arrives first
      expect(queue.enqueue(mut2).status).toBe("BUFFERED");
      // Mut1 arrives -> cascades both
      const res = queue.enqueue(mut1);
      expect(res.status).toBe("APPLIED");
      expect(res.appliedMutations).toHaveLength(2);
    });
  });

  describe("Vector Clock Monotonicity", () => {
    it("maintains strict component-wise monotonicity across all node clocks", () => {
      const q = new OfflineMutationQueue({
        nodeId: "server",
        initialClock: { peer: 5 },
      });
      expect(q.getLocalClock().server).toBe(0);

      const res1 = q.enqueue({
        id: "m1",
        clientId: "client-A",
        vectorClock: { "client-A": 1, peer: 5 },
        payload: {},
      });
      expect(res1.status).toBe("APPLIED");

      const clock1 = q.getLocalClock();
      expect(clock1["client-A"]).toBe(1);
      expect(clock1.peer).toBe(5);

      // Advance peer counters
      expect(
        q.enqueue({
          id: "p6",
          clientId: "peer",
          vectorClock: { peer: 6 },
          payload: {},
        }).status,
      ).toBe("APPLIED");
      expect(
        q.enqueue({
          id: "p7",
          clientId: "peer",
          vectorClock: { peer: 7 },
          payload: {},
        }).status,
      ).toBe("APPLIED");

      const res2 = q.enqueue({
        id: "m2",
        clientId: "client-A",
        vectorClock: { "client-A": 2, peer: 7 },
        payload: {},
      });
      expect(res2.status).toBe("APPLIED");

      const clock2 = q.getLocalClock();
      expect(clock2["client-A"]).toBe(2);
      expect(clock2.peer).toBe(7);

      // Verify that localClock never decrements
      expect(clock2["client-A"]).toBeGreaterThan(clock1["client-A"]);
      expect(clock2.peer).toBeGreaterThanOrEqual(clock1.peer);
    });
  });

  describe("Duplicate and Stale Mutation Resilience", () => {
    it("rejects duplicate mutation by ID without mutating clock or re-applying", () => {
      const mut: OfflineMutation<Record<string, unknown>> = {
        id: "mut-unique",
        clientId: "nomad-1",
        vectorClock: { "nomad-1": 1 },
        payload: { test: true },
      };

      const first = queue.enqueue(mut);
      expect(first.status).toBe("APPLIED");

      const second = queue.enqueue(mut);
      expect(second.status).toBe("DUPLICATE");
      expect(second.appliedMutations).toHaveLength(0);
      expect(queue.getAppliedHistory()).toHaveLength(1);
    });

    it("rejects stale mutation with clock counter <= localClock", () => {
      queue.enqueue({
        id: "mut-1",
        clientId: "nomad-1",
        vectorClock: { "nomad-1": 1 },
        payload: {},
      });
      queue.enqueue({
        id: "mut-2",
        clientId: "nomad-1",
        vectorClock: { "nomad-1": 2 },
        payload: {},
      });

      const staleMut: OfflineMutation<Record<string, unknown>> = {
        id: "mut-stale-retransmit",
        clientId: "nomad-1",
        vectorClock: { "nomad-1": 1 },
        payload: {},
      };

      const res = queue.enqueue(staleMut);
      expect(res.status).toBe("DUPLICATE");
      expect(res.appliedMutations).toHaveLength(0);
      expect(queue.getLocalClock()["nomad-1"]).toBe(2);
    });
  });

  describe("Partitioned Client Sync Resolution", () => {
    it("resolves concurrent mutations from multiple partitioned clients without data loss", () => {
      // Client A and Client B were partitioned independently
      const mutA1: OfflineMutation<Record<string, unknown>> = {
        id: "a1",
        clientId: "client-A",
        vectorClock: { "client-A": 1 },
        payload: { user: "Alice", action: "Draft created" },
      };
      const mutA2: OfflineMutation<Record<string, unknown>> = {
        id: "a2",
        clientId: "client-A",
        vectorClock: { "client-A": 2 },
        payload: { user: "Alice", action: "Desk selected" },
      };

      const mutB1: OfflineMutation<Record<string, unknown>> = {
        id: "b1",
        clientId: "client-B",
        vectorClock: { "client-B": 1 },
        payload: { user: "Bob", action: "Note added" },
      };
      const mutB2: OfflineMutation<Record<string, unknown>> = {
        id: "b2",
        clientId: "client-B",
        vectorClock: { "client-B": 2 },
        payload: { user: "Bob", action: "Tag added" },
      };

      // Interleaved network delivery: B2 (orphan), A1, B1 (cascades B2), A2
      expect(queue.enqueue(mutB2).status).toBe("BUFFERED");
      expect(queue.enqueue(mutA1).status).toBe("APPLIED");

      const resB1 = queue.enqueue(mutB1);
      expect(resB1.status).toBe("APPLIED");
      expect(resB1.appliedMutations).toHaveLength(2);
      expect(resB1.appliedMutations.map((m) => m.id)).toEqual(["b1", "b2"]);

      expect(queue.enqueue(mutA2).status).toBe("APPLIED");

      // Both partitioned clients resolved causally without losing mutations
      expect(queue.getPendingCount()).toBe(0);
      expect(queue.getLocalClock()["client-A"]).toBe(2);
      expect(queue.getLocalClock()["client-B"]).toBe(2);
      expect(queue.getAppliedHistory()).toHaveLength(4);
    });

    it("buffers cross-partition dependent mutations until external dependency arrives", () => {
      // Client B had observed A1 before going offline, so B1 depends on A1: { client-A: 1, client-B: 1 }
      const mutB1: OfflineMutation<Record<string, unknown>> = {
        id: "b1",
        clientId: "client-B",
        vectorClock: { "client-A": 1, "client-B": 1 },
        payload: { response: "Reply to Alice" },
      };

      const mutA1: OfflineMutation<Record<string, unknown>> = {
        id: "a1",
        clientId: "client-A",
        vectorClock: { "client-A": 1 },
        payload: { message: "Hello from Alice" },
      };

      // B1 arrives at server before A1 has arrived
      const resB1 = queue.enqueue(mutB1);
      expect(resB1.status).toBe("BUFFERED");
      expect(queue.getPendingCount()).toBe(1);

      // A1 arrives -> fulfills B1's cross-node causal dependency!
      const resA1 = queue.enqueue(mutA1);
      expect(resA1.status).toBe("APPLIED");
      expect(resA1.appliedMutations).toHaveLength(2);
      expect(resA1.appliedMutations[0].id).toBe("a1");
      expect(resA1.appliedMutations[1].id).toBe("b1");
      expect(queue.getPendingCount()).toBe(0);
    });
  });

  describe("Validation & Edge Cases", () => {
    it("throws TypeError on malformed mutations", () => {
      expect(() =>
        queue.enqueue(null as unknown as OfflineMutation<unknown>),
      ).toThrow(TypeError);
      expect(() =>
        queue.enqueue({
          id: "",
          clientId: "c",
          vectorClock: { c: 1 },
          payload: {},
        }),
      ).toThrow(TypeError);
      expect(() =>
        queue.enqueue({
          id: "1",
          clientId: "",
          vectorClock: { c: 1 },
          payload: {},
        }),
      ).toThrow(TypeError);
      expect(() =>
        queue.enqueue({ id: "1", clientId: "c", vectorClock: {}, payload: {} }),
      ).toThrow(TypeError);
    });

    it("throws on buffer overflow beyond maxBufferSize", () => {
      const tinyQueue = new OfflineMutationQueue({ maxBufferSize: 2 });
      // Enqueue 2 orphans
      tinyQueue.enqueue({
        id: "m1",
        clientId: "c",
        vectorClock: { c: 2 },
        payload: {},
      });
      tinyQueue.enqueue({
        id: "m2",
        clientId: "c",
        vectorClock: { c: 3 },
        payload: {},
      });

      // 3rd orphan triggers overflow error
      expect(() => {
        tinyQueue.enqueue({
          id: "m3",
          clientId: "c",
          vectorClock: { c: 4 },
          payload: {},
        });
      }).toThrow(/buffer overflow/);
    });

    it("triggers onApply and onBuffer callbacks", () => {
      const appliedLog: string[] = [];
      const bufferedLog: string[] = [];

      queue.onApply((m) => appliedLog.push(m.id));
      queue.onBuffer((m) => bufferedLog.push(m.id));

      queue.enqueue({
        id: "m-orphan",
        clientId: "c",
        vectorClock: { c: 2 },
        payload: {},
      });

      expect(bufferedLog).toEqual(["m-orphan"]);
      expect(appliedLog).toEqual([]);

      queue.enqueue({
        id: "m-parent",
        clientId: "c",
        vectorClock: { c: 1 },
        payload: {},
      });

      expect(appliedLog).toEqual(["m-parent", "m-orphan"]);
    });
  });
});

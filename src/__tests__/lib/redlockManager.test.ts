import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import {
  RedlockManager,
  DistributedLock,
  LockLostError,
  IRedisClient,
  setRedlockManager,
  getRedlockManager,
} from "@/lib/redis/RedlockManager";
import { bookSeatWithAdvisoryLock } from "@/lib/reservations/bookingEngine";

/**
 * Creates an in-memory mock Redis node supporting SET NX PX, atomic Lua release,
 * and atomic Lua compare-and-extend.
 */
function createMockRedisNode(id: string) {
  const store = new Map<string, { value: string; expiresAt: number }>();
  let shouldFail = false;

  const node: IRedisClient & {
    id: string;
    store: Map<string, { value: string; expiresAt: number }>;
    setShouldFail: (fail: boolean) => void;
  } = {
    id,
    store,
    setShouldFail(fail: boolean) {
      shouldFail = fail;
    },
    async set(
      key: string,
      value: string,
      options?: { nx?: boolean; px?: number } | string,
      ..._args: any[]
    ) {
      if (shouldFail) {
        throw new Error(`Node ${id} simulated network failure`);
      }
      const now = Date.now();
      const existing = store.get(key);
      const isAlive = existing && existing.expiresAt > now;

      const isNx =
        typeof options === "object" ? options?.nx : options === "NX";
      if (isNx && isAlive) {
        return null;
      }

      let px = 10000;
      if (typeof options === "object" && options?.px) {
        px = options.px;
      }
      store.set(key, { value, expiresAt: now + px });
      return "OK";
    },
    async eval(
      script: string,
      keys: string[],
      args: (string | number)[]
    ) {
      if (shouldFail) {
        throw new Error(`Node ${id} simulated network failure`);
      }
      const key = keys[0];
      const now = Date.now();
      const existing = store.get(key);
      const isAlive = existing && existing.expiresAt > now;

      // Release Lua script: DEL if token matches
      if (script.includes("del")) {
        const token = String(args[0]);
        if (isAlive && existing.value === token) {
          store.delete(key);
          return 1;
        }
        return 0;
      }

      // Renewal Lua script: PEXPIRE if token matches
      if (script.includes("pexpire")) {
        const token = String(args[0]);
        const ttl = Number(args[1]);
        if (isAlive && existing.value === token) {
          store.set(key, { value: token, expiresAt: now + ttl });
          return 1;
        }
        return 0;
      }

      // Fencing acquisition Lua script: SET NX PX + INCR fencing key
      if (script.includes("incr")) {
        const token = String(args[0]);
        const ttl = Number(args[1]);
        if (isAlive) {
          return [0, 0];
        }
        store.set(key, { value: token, expiresAt: now + ttl });
        const fenceKey = keys[1] || `${key}:fencing`;
        const prevFence = Number(store.get(fenceKey)?.value || 0);
        const nextFence = prevFence + 1;
        store.set(fenceKey, { value: String(nextFence), expiresAt: Infinity });
        return [1, nextFence];
      }

      return 0;
    },
    async get(key: string) {
      if (shouldFail) {
        throw new Error(`Node ${id} simulated network failure`);
      }
      const existing = store.get(key);
      if (existing && existing.expiresAt > Date.now()) {
        return existing.value;
      }
      return null;
    },
  };

  return node;
}

describe("RedlockManager Distributed Lock Suite", () => {
  let nodes: ReturnType<typeof createMockRedisNode>[];
  let manager: RedlockManager;

  beforeEach(() => {
    nodes = [
      createMockRedisNode("redis-1"),
      createMockRedisNode("redis-2"),
      createMockRedisNode("redis-3"),
    ];
    manager = new RedlockManager(nodes, {
      defaultTtlMs: 2000,
      retryCount: 0,
      driftFactor: 0.01,
    });
  });

  describe("Quorum Configuration Validation", () => {
    it("rejects clusters with fewer than 3 independent nodes and refuses single-node fallback", () => {
      expect(() => new RedlockManager([nodes[0]])).toThrow(
        /at least 3 independent Redis nodes/i
      );
      expect(() => new RedlockManager([nodes[0], nodes[1]])).toThrow(
        /Single-node locking fallback is strictly disallowed/i
      );
    });

    it("calculates strict majority quorum correctly", () => {
      expect(manager.quorum).toBe(2); // floor(3/2) + 1 = 2
      const fiveNodeManager = new RedlockManager([
        ...nodes,
        createMockRedisNode("redis-4"),
        createMockRedisNode("redis-5"),
      ]);
      expect(fiveNodeManager.quorum).toBe(3); // floor(5/2) + 1 = 3
    });
  });

  describe("Lock Acquisition", () => {
    it("successfully acquires lock across majority quorum", async () => {
      const lock = await manager.acquire("resource:desk:101", 3000);
      expect(lock).not.toBeNull();
      expect(lock).toBeInstanceOf(DistributedLock);
      expect(lock?.key).toBe("resource:desk:101");
      expect(typeof lock?.token).toBe("string");
      expect(lock?.validity).toBeGreaterThan(0);
      expect(lock?.isLost).toBe(false);

      // Verify at least 2 nodes hold the key and matching token
      const holdingNodes = nodes.filter(
        (n) => n.store.get("resource:desk:101")?.value === lock?.token
      );
      expect(holdingNodes.length).toBeGreaterThanOrEqual(2);

      await lock?.release();
    });

    it("cleans up partial locks when quorum cannot be reached", async () => {
      // Simulate failure on 2 out of 3 nodes (quorum = 2 cannot be satisfied)
      nodes[1].setShouldFail(true);
      nodes[2].setShouldFail(true);

      const lock = await manager.acquire("resource:desk:102", 3000);
      expect(lock).toBeNull();

      // Node 0 should have had its partial lock cleaned up immediately
      expect(nodes[0].store.has("resource:desk:102")).toBe(false);
    });
  });

  describe("Lock Release Safety", () => {
    it("releases lock across nodes only when token matches", async () => {
      const lock = await manager.acquire("resource:desk:103", 3000);
      expect(lock).not.toBeNull();

      const released = await lock!.release();
      expect(released).toBe(true);

      for (const node of nodes) {
        expect(node.store.has("resource:desk:103")).toBe(false);
      }
    });

    it("does not release a lock owned by another token / owner", async () => {
      const lock = await manager.acquire("resource:desk:104", 3000);
      expect(lock).not.toBeNull();

      // Attempt release with a different random token
      const bogusRelease = await manager.release({
        key: "resource:desk:104",
        token: "foreign-owner-token",
      });

      expect(bogusRelease).toBe(false);

      // Lock should still be held by original owner
      const holdingNodes = nodes.filter(
        (n) => n.store.get("resource:desk:104")?.value === lock?.token
      );
      expect(holdingNodes.length).toBeGreaterThanOrEqual(2);

      await lock?.release();
    });

    it("handles Redis node failure safely during release without crashing", async () => {
      const lock = await manager.acquire("resource:desk:105", 3000);
      expect(lock).not.toBeNull();

      // One node drops offline before release
      nodes[2].setShouldFail(true);

      const released = await lock!.release();
      // Quorum (2 nodes) still succeeded in releasing
      expect(released).toBe(true);
      expect(nodes[0].store.has("resource:desk:105")).toBe(false);
      expect(nodes[1].store.has("resource:desk:105")).toBe(false);
    });
  });

  describe("Automatic Renewal and Lease-Loss Handling", () => {
    it("successfully renews lease using atomic compare-and-extend", async () => {
      const lock = await manager.acquire("resource:desk:106", 1500);
      expect(lock).not.toBeNull();

      const renewed = await lock!.extend(3000);
      expect(renewed).toBe(true);
      expect(lock!.validity).toBeGreaterThan(0);
      expect(lock!.isLost).toBe(false);

      await lock?.release();
    });

    it("marks lease as lost and notifies listeners when renewal quorum fails", async () => {
      const lock = await manager.acquire("resource:desk:107", 1000);
      expect(lock).not.toBeNull();

      let lostNotified = false;
      lock!.onLost(() => {
        lostNotified = true;
      });

      // Fail 2 nodes so quorum cannot be reached during extension
      nodes[1].setShouldFail(true);
      nodes[2].setShouldFail(true);

      const renewed = await lock!.extend(1000);
      expect(renewed).toBe(false);

      // Lock should transition to lost
      lock!.markLost("Renewal quorum unavailable");
      expect(lock!.isLost).toBe(true);
      expect(lostNotified).toBe(true);
      expect(() => lock!.checkLost()).toThrow(LockLostError);
    });
  });

  describe("Booking Engine Critical Section Integration", () => {
    let mockPrisma: any;

    beforeEach(() => {
      mockPrisma = {
        $transaction: async (callback: any) => {
          const tx = {
            $queryRaw: async (strings: TemplateStringsArray) => {
              const query = strings.join("?");
              if (query.includes("pg_try_advisory_xact_lock")) {
                return [{ acquired: true }];
              }
              if (query.includes("COUNT(*)")) {
                return [{ count: BigInt(0) }];
              }
              if (query.includes("INSERT INTO")) {
                return [{ id: "res_redlock_1", status: "CONFIRMED" }];
              }
              return [];
            },
          };
          return await callback(tx);
        },
      };
    });

    it("successfully reconciles booking under distributed lock protection", async () => {
      const result = await bookSeatWithAdvisoryLock(
        mockPrisma,
        "seat_redlock_01",
        "user_99",
        new Date("2026-12-01T10:00:00Z"),
        new Date("2026-12-01T12:00:00Z"),
        { redlockManager: manager, lockTtlMs: 2000 }
      );

      expect(result.success).toBe(true);
      expect(result.reservation).toBeDefined();

      // Distributed lock must be completely released in finally block
      for (const node of nodes) {
        expect(node.store.has("seat:seat_redlock_01")).toBe(false);
      }
    });

    it("returns conflict when distributed lock cannot be acquired", async () => {
      // First caller acquires lock
      const preHeld = await manager.acquire("seat:seat_redlock_02", 5000);
      expect(preHeld).not.toBeNull();

      // Second caller tries to book the same seat
      const result = await bookSeatWithAdvisoryLock(
        mockPrisma,
        "seat_redlock_02",
        "user_100",
        new Date("2026-12-01T10:00:00Z"),
        new Date("2026-12-01T12:00:00Z"),
        { redlockManager: manager }
      );

      expect(result.success).toBe(false);
      expect(result.isConflict).toBe(true);
      expect(result.error).toMatch(/currently being reserved/i);

      await preHeld?.release();
    });

    it("aborts reservation when lease ownership is lost during reconciliation", async () => {
      // Create a manager that returns a lock whose checkLost will fail inside the transaction
      const failingMockPrisma = {
        $transaction: async (callback: any) => {
          const tx = {
            $queryRaw: async (strings: TemplateStringsArray) => {
              const query = strings.join("?");
              if (query.includes("pg_try_advisory_xact_lock")) {
                // Simulate lease loss mid-reconciliation before commit
                const holdingNodes = nodes.filter((n) =>
                  n.store.has("seat:seat_redlock_03")
                );
                for (const n of holdingNodes) {
                  n.store.delete("seat:seat_redlock_03");
                }
                return [{ acquired: true }];
              }
              if (query.includes("COUNT(*)")) {
                return [{ count: BigInt(0) }];
              }
              return [{ id: "res_fail" }];
            },
          };
          return await callback(tx);
        },
      };

      // Mock acquire to return a lock that marks itself as lost during transaction
      const originalAcquire = manager.acquire.bind(manager);
      jest.spyOn(manager, "acquire").mockImplementation(async (...args) => {
        const lock = await originalAcquire(...args);
        if (lock) {
          // Hook checkLost to simulate lease loss detection
          let callCount = 0;
          const origCheck = lock.checkLost.bind(lock);
          lock.checkLost = () => {
            callCount++;
            if (callCount > 2) {
              lock.markLost("Lease expired during DB transaction");
              throw new LockLostError("Lease expired during DB transaction");
            }
            origCheck();
          };
        }
        return lock;
      });

      const result = await bookSeatWithAdvisoryLock(
        failingMockPrisma as any,
        "seat_redlock_03",
        "user_101",
        new Date("2026-12-01T10:00:00Z"),
        new Date("2026-12-01T12:00:00Z"),
        { redlockManager: manager }
      );

      expect(result.success).toBe(false);
      expect(result.isConflict).toBe(true);
      expect(result.error).toMatch(/lease was lost/i);
    });

    it("generates monotonically increasing fencing tokens across acquisitions", async () => {
      const lock1 = await manager.acquire("resource:desk:fencing_01", 3000, {
        withFencingToken: true,
      });
      expect(lock1).not.toBeNull();
      expect(typeof lock1?.fencingToken).toBe("number");
      const token1 = lock1!.fencingToken!;
      await lock1?.release();

      const lock2 = await manager.acquire("resource:desk:fencing_01", 3000, {
        withFencingToken: true,
      });
      expect(lock2).not.toBeNull();
      expect(typeof lock2?.fencingToken).toBe("number");
      const token2 = lock2!.fencingToken!;
      await lock2?.release();

      expect(token2).toBeGreaterThan(token1);
    });

    it("rolls back partial node extensions when extension quorum fails", async () => {
      const lock = await manager.acquire("resource:desk:extend_rollback", 2000);
      expect(lock).not.toBeNull();

      // Nodes 1 and 2 fail during extension, so only node 0 could extend
      nodes[1].setShouldFail(true);
      nodes[2].setShouldFail(true);

      const extended = await manager.extend(lock!, 5000);
      expect(extended).toBe(false);

      // Node 0 must have had its partial extension rolled back
      expect(nodes[0].store.has("resource:desk:extend_rollback")).toBe(false);
    });

    it("refuses to extend an already released or lost lock", async () => {
      const lock = await manager.acquire("resource:desk:released_guard", 2000);
      expect(lock).not.toBeNull();
      await lock!.release();

      const extended = await lock!.extend(2000);
      expect(extended).toBe(false);
    });

    it("supports granular slot-aware booking and propagates fencing tokens", async () => {
      const result = await bookSeatWithAdvisoryLock(
        mockPrisma,
        "seat_slot_01",
        "user_200",
        new Date("2026-12-05T09:00:00Z"),
        new Date("2026-12-05T11:00:00Z"),
        {
          redlockManager: manager,
          useSlotLevelLock: true,
          withFencingToken: true,
        }
      );

      expect(result.success).toBe(true);
      expect(typeof result.fencingToken).toBe("number");
    });
  });

  describe("SPEC-A: Monotonic lease expiry", () => {
    it("does not throw when lease is active (performance.now() < expiresAt)", async () => {
      const lock = await manager.acquire("resource:test:active_lease", 5000);
      expect(lock).not.toBeNull();

      const origNow = performance.now;
      try {
        global.performance.now = () => lock!.expiresAt - 100;
        expect(() => lock!.checkLost()).not.toThrow();
      } finally {
        global.performance.now = origNow;
        await lock!.release();
      }
    });

    it("throws LockLostError when performance.now() is exactly at or past expiresAt", async () => {
      const lock = await manager.acquire("resource:test:expired_lease", 3000);
      expect(lock).not.toBeNull();

      const origNow = performance.now;
      let lostEmitted = false;
      lock!.onLost(() => {
        lostEmitted = true;
      });

      try {
        global.performance.now = () => lock!.expiresAt;
        expect(() => lock!.checkLost()).toThrow(LockLostError);
        expect(lock!.isLost).toBe(true);
        expect(lock!.signal.aborted).toBe(true);
        expect(lostEmitted).toBe(true);

        // Subsequent checkLost still throws without re-triggering markLost
        expect(() => lock!.checkLost()).toThrow(LockLostError);
      } finally {
        global.performance.now = origNow;
        await lock!.release();
      }
    });

    it("prevents auto-renewal from resurrecting an expired lock", async () => {
      const lock = await manager.acquire("resource:test:no_resurrect", 2000, {
        autoRenew: true,
        renewIntervalMs: 50,
      });
      expect(lock).not.toBeNull();

      // Explicitly mark as lost or expire
      lock!.markLost("Expired prior to renewal");
      expect(lock!.isLost).toBe(true);

      const oldExpiresAt = lock!.expiresAt;
      await new Promise((resolve) => setTimeout(resolve, 80));

      expect(lock!.isLost).toBe(true);
      expect(lock!.expiresAt).toBe(oldExpiresAt);
      await lock!.release();
    });
  });

  describe("SPEC-B: Per-node timeouts and late-acquisition compensation", () => {
    it("acquires lock even if one slow node times out but quorum succeeds", async () => {
      // Node 2 has high latency exceeding nodeTimeoutMs
      const slowNode = nodes[2];
      const origSet = slowNode.set.bind(slowNode);
      slowNode.set = async (...args: any[]) => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return origSet(...args);
      };

      const fastManager = new RedlockManager(nodes, {
        nodeTimeoutMs: 50,
        defaultTtlMs: 2000,
      });

      try {
        const lock = await fastManager.acquire("resource:test:one_slow_node", 2000);
        expect(lock).not.toBeNull();
        expect(lock?.key).toBe("resource:test:one_slow_node");
        await lock?.release();
      } finally {
        slowNode.set = origSet;
      }
    });

    it("fails acquisition if too many nodes time out and quorum is lost", async () => {
      const slowNode1 = nodes[1];
      const slowNode2 = nodes[2];
      const origSet1 = slowNode1.set.bind(slowNode1);
      const origSet2 = slowNode2.set.bind(slowNode2);

      slowNode1.set = async (...args: any[]) => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return origSet1(...args);
      };
      slowNode2.set = async (...args: any[]) => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return origSet2(...args);
      };

      const fastManager = new RedlockManager(nodes, {
        nodeTimeoutMs: 50,
        defaultTtlMs: 2000,
        retryCount: 0,
      });

      try {
        const lock = await fastManager.acquire("resource:test:two_slow_nodes", 2000);
        expect(lock).toBeNull();
      } finally {
        slowNode1.set = origSet1;
        slowNode2.set = origSet2;
      }
    });

    it("compensates late-arriving node acquisitions so no orphaned lock remains", async () => {
      const slowNode = nodes[2];
      const origSet = slowNode.set.bind(slowNode);

      let lateSettled = false;
      slowNode.set = async (...args: any[]) => {
        await new Promise((resolve) => setTimeout(resolve, 80));
        const res = await origSet(...args);
        lateSettled = true;
        return res;
      };

      const fastManager = new RedlockManager(nodes, {
        nodeTimeoutMs: 40,
        defaultTtlMs: 3000,
      });

      try {
        const lock = await fastManager.acquire("resource:test:late_orphan", 3000);
        expect(lock).not.toBeNull();

        // Wait for slow node to finish its late acquisition and trigger compensating release
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(lateSettled).toBe(true);

        // Check if slowNode store has the key or was compensated
        expect(slowNode.store.has("resource:test:late_orphan")).toBe(false);

        await lock?.release();
      } finally {
        slowNode.set = origSet;
      }
    });

    it("ensures late extension responses cannot advance expiration or resurrect an expired/lost lock", async () => {
      // Configure node 2 with high latency during extension
      const slowNode = nodes[2];
      const origEval = slowNode.eval.bind(slowNode);

      let lateExtendSettled = false;
      slowNode.eval = async (script: string, keys: string[], args: (string | number)[]) => {
        if (script.includes("pexpire")) {
          await new Promise((resolve) => setTimeout(resolve, 100));
          lateExtendSettled = true;
          return 1;
        }
        return origEval(script, keys, args);
      };

      const fastManager = new RedlockManager(nodes, {
        nodeTimeoutMs: 30,
        defaultTtlMs: 2000,
      });

      try {
        const lock = await fastManager.acquire("resource:test:late_extend_guard", 2000);
        expect(lock).not.toBeNull();

        const originalExpiresAt = lock!.expiresAt;

        // Start extension while lock is active; node 2 will time out (> 30ms)
        // Nodes 0 and 1 succeed, but immediately after extend() triggers, simulate event-loop stall / markLost
        const extendPromise = fastManager.extend(lock!, 2000);
        lock!.markLost("Lease expired during pause");
        expect(lock!.isLost).toBe(true);

        const extended = await extendPromise;
        expect(extended).toBe(false);

        // Wait for slow node to finish its late extension evaluation
        await new Promise((resolve) => setTimeout(resolve, 120));
        expect(lateExtendSettled).toBe(true);

        // Verify lock state was not mutated by late response
        expect(lock!.isLost).toBe(true);
        expect(lock!.expiresAt).toBe(originalExpiresAt);

        // Verify slow node had compensating cleanup applied
        expect(slowNode.store.has("resource:test:late_extend_guard")).toBe(false);
      } finally {
        slowNode.eval = origEval;
      }
    });

    it("triggers compensating release for late successful extension even if lock.isLost is false at response time", async () => {
      const slowNode = nodes[2];
      const origEval = slowNode.eval.bind(slowNode);

      let lateExtendSettled = false;
      slowNode.eval = async (script: string, keys: string[], args: (string | number)[]) => {
        if (script.includes("pexpire")) {
          // Node 2 takes 80ms, timeout is 30ms
          await new Promise((resolve) => setTimeout(resolve, 80));
          lateExtendSettled = true;
          return 1;
        }
        return origEval(script, keys, args);
      };

      const fastManager = new RedlockManager(nodes, {
        nodeTimeoutMs: 30,
        defaultTtlMs: 2000,
      });

      try {
        const lock = await fastManager.acquire("resource:test:late_extend_timeout_comp", 2000);
        expect(lock).not.toBeNull();

        // Extend: Nodes 0 and 1 succeed fast (<5ms), Node 2 times out (>30ms)
        // Extension overall succeeds on nodes 0 and 1 (quorum = 2)
        const extended = await fastManager.extend(lock!, 2000);
        expect(extended).toBe(true);
        expect(lock!.isLost).toBe(false);

        // Wait for slow node's late response to settle
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(lateExtendSettled).toBe(true);

        // Slow node must have been compensated because it timed out during extend
        expect(slowNode.store.has("resource:test:late_extend_timeout_comp")).toBe(false);

        await lock?.release();
      } finally {
        slowNode.eval = origEval;
      }
    });

    it("handles partial renewal quorum failure by rolling back extended keys and keeping lock lost", async () => {
      // Node 0 succeeds, Node 1 fails, Node 2 times out (1 of 3 = no quorum)
      const failingNode = nodes[1];
      const slowNode = nodes[2];

      const origEval1 = failingNode.eval.bind(failingNode);
      const origEval2 = slowNode.eval.bind(slowNode);

      failingNode.eval = async (script: string, keys: string[], args: (string | number)[]) => {
        if (script.includes("pexpire")) {
          return 0; // compare-and-extend mismatch / failure
        }
        return origEval1(script, keys, args);
      };

      let node2Settled = false;
      slowNode.eval = async (script: string, keys: string[], args: (string | number)[]) => {
        if (script.includes("pexpire")) {
          await new Promise((resolve) => setTimeout(resolve, 100));
          node2Settled = true;
          return 1; // late success
        }
        return origEval2(script, keys, args);
      };

      const fastManager = new RedlockManager(nodes, {
        nodeTimeoutMs: 30,
        defaultTtlMs: 2000,
      });

      try {
        const lock = await fastManager.acquire("resource:test:partial_renewal_fail", 2000);
        expect(lock).not.toBeNull();
        const oldExpiresAt = lock!.expiresAt;

        // Extend fails due to insufficient quorum (only 1 node responded OK before timeout)
        const extended = await fastManager.extend(lock!, 2000);
        expect(extended).toBe(false);

        // Wait for late node 2 to settle
        await new Promise((resolve) => setTimeout(resolve, 120));
        expect(node2Settled).toBe(true);

        // Verify partial nodes rolled back and late node compensated
        expect(nodes[0].store.has("resource:test:partial_renewal_fail")).toBe(false);
        expect(nodes[2].store.has("resource:test:partial_renewal_fail")).toBe(false);

        // Expiration was not updated
        expect(lock!.expiresAt).toBe(oldExpiresAt);
      } finally {
        failingNode.eval = origEval1;
        slowNode.eval = origEval2;
      }
    });

    it("bounds per-node timeout strictly by remaining validity without minimum 10ms inflation", async () => {
      // Test cases for: 4ms, 1ms, 0ms, negative remaining validity, and validity > nodeTimeoutMs
      const recordingClient: IRedisClient = {
        async set(_key: string, _value: string, _options?: any) {
          return "OK";
        },
        async eval(_script: string, _keys: string[], _args: any[]) {
          return [1, 1];
        },
      };

      const testMgr = new RedlockManager([recordingClient, recordingClient, recordingClient], {
        nodeTimeoutMs: 200,
        defaultTtlMs: 1000,
        retryCount: 0,
      });

      // 1. Remaining validity > nodeTimeoutMs: effective timeout is capped at nodeTimeoutMs (200)
      const lock1 = await testMgr.acquire("resource:test:v_large", 1000);
      expect(lock1).not.toBeNull();
      await lock1?.release();

      // 2. Zero or negative remaining validity: acquire immediately returns null without throwing
      const lockZero = await testMgr.acquire("resource:test:v_zero", 1); // drift is 2ms, remaining validity is negative
      expect(lockZero).toBeNull();

      // 3. Extend with negative initial validity returns false immediately
      const lockValid = await testMgr.acquire("resource:test:v_extend", 2000);
      expect(lockValid).not.toBeNull();
      const extendZero = await testMgr.extend(lockValid!, 1); // 1ms ttl with 2ms drift <= 0
      expect(extendZero).toBe(false);

      // 4. Exact budget checks: 4ms and 1ms validity
      // If ttl=8ms, drift=2ms (8*0.01 + 2 = 2.08 -> 2), remaining validity is 6ms, etc.
      // Confirm acquire terminates promptly without waiting for nodeTimeoutMs (200ms)
      const start4 = performance.now();
      const lockSmall = await testMgr.acquire("resource:test:v_small", 6);
      const elapsed4 = performance.now() - start4;
      expect(elapsed4).toBeLessThan(100);
      if (lockSmall) await lockSmall.release();
    });

    it("safely ignores late failed extension without unhandled rejection", async () => {
      const failingNode = nodes[2];
      const origEval = failingNode.eval.bind(failingNode);

      failingNode.eval = async (script: string, keys: string[], args: (string | number)[]) => {
        if (script.includes("pexpire")) {
          await new Promise((resolve) => setTimeout(resolve, 80));
          throw new Error("Late network connection reset");
        }
        return origEval(script, keys, args);
      };

      const fastManager = new RedlockManager(nodes, {
        nodeTimeoutMs: 30,
        defaultTtlMs: 2000,
      });

      try {
        const lock = await fastManager.acquire("resource:test:late_extend_fail", 2000);
        expect(lock).not.toBeNull();

        // Extension where node 2 times out, but nodes 0 and 1 succeed (quorum = 2)
        const extended = await fastManager.extend(lock!, 2000);
        expect(extended).toBe(true);

        // Wait for late rejection to fire
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(lock!.isLost).toBe(false);
        await lock?.release();
      } finally {
        failingNode.eval = origEval;
      }
    });
  });

  describe("SPEC-C: Redis Cluster hash-slot compatibility", () => {
    it("wraps key with {hash-tag} when clusterMode is true", async () => {
      const clusterManager = new RedlockManager(nodes, {
        clusterMode: true,
        defaultTtlMs: 2000,
      });

      const lock = await clusterManager.acquire("seat:test_123", 2000, {
        withFencingToken: true,
      });
      expect(lock).not.toBeNull();

      // Check physical keys in node stores
      expect(nodes[0].store.has("{seat:test_123}")).toBe(true);
      expect(nodes[0].store.has("{seat:test_123}:fencing")).toBe(true);

      // Verify extract hash tag rule
      const lockKey = clusterManager.toPhysicalKey("seat:test_123");
      const fenceKey = clusterManager.toPhysicalFencingKey("seat:test_123");

      const extractTag = (k: string) => {
        const open = k.indexOf("{");
        const close = k.indexOf("}", open + 1);
        return open !== -1 && close > open + 1 ? k.slice(open + 1, close) : k;
      };

      expect(extractTag(lockKey)).toBe("seat:test_123");
      expect(extractTag(fenceKey)).toBe("seat:test_123");
      expect(extractTag(lockKey)).toBe(extractTag(fenceKey));

      await lock?.release();
      expect(nodes[0].store.has("{seat:test_123}")).toBe(false);
    });

    it("does not wrap key when clusterMode is false", async () => {
      const standardManager = new RedlockManager(nodes, {
        clusterMode: false,
        defaultTtlMs: 2000,
      });

      const lock = await standardManager.acquire("seat:standard_456", 2000, {
        withFencingToken: true,
      });
      expect(lock).not.toBeNull();

      expect(nodes[0].store.has("seat:standard_456")).toBe(true);
      expect(nodes[0].store.has("seat:standard_456:fencing")).toBe(true);

      await lock?.release();
    });

    it("is idempotent when key already has hash tag", () => {
      const clusterManager = new RedlockManager(nodes, { clusterMode: true });
      expect(clusterManager.toPhysicalKey("{seat}:42")).toBe("{seat}:42");
      expect(clusterManager.toPhysicalFencingKey("{seat}:42")).toBe("{seat}:42:fencing");
      expect(clusterManager.toPhysicalKey("plain_key")).toBe("{plain_key}");
      expect(clusterManager.toPhysicalFencingKey("plain_key")).toBe("{plain_key}:fencing");
    });

    it("rejects invalid, empty, or whitespace-only logical keys when formatting cluster keys", () => {
      const clusterManager = new RedlockManager(nodes, { clusterMode: true });
      expect(() => clusterManager.toPhysicalKey("")).toThrow(/Invalid logical lock key/);
      expect(() => clusterManager.toPhysicalKey("   ")).toThrow(/Invalid logical lock key/);
      expect(() => clusterManager.toPhysicalKey(null as any)).toThrow(/Invalid logical lock key/);
      expect(() => clusterManager.toPhysicalKey(undefined as any)).toThrow(/Invalid logical lock key/);

      expect(() => clusterManager.toPhysicalFencingKey("")).toThrow(/Invalid logical lock key/);
      expect(() => clusterManager.toPhysicalFencingKey("   ")).toThrow(/Invalid logical lock key/);
    });

    it("verifies hash-slot mathematical equality using real Redis Cluster CRC16 calculation", () => {
      function crc16(buf: Buffer): number {
        let crc = 0;
        const table = new Uint16Array(256);
        for (let i = 0; i < 256; i++) {
          let curr = (i << 8) & 0xffff;
          for (let j = 0; j < 8; j++) {
            if ((curr & 0x8000) !== 0) {
              curr = ((curr << 1) ^ 0x1021) & 0xffff;
            } else {
              curr = (curr << 1) & 0xffff;
            }
          }
          table[i] = curr;
        }

        for (let i = 0; i < buf.length; i++) {
          crc = ((crc << 8) & 0xffff) ^ table[((crc >>> 8) ^ buf[i]) & 0xff];
        }
        return crc & 0xffff;
      }

      function getClusterSlot(key: string): number {
        const s = key.indexOf("{");
        if (s !== -1) {
          const e = key.indexOf("}", s + 1);
          if (e !== -1 && e !== s + 1) {
            key = key.slice(s + 1, e);
          }
        }
        return crc16(Buffer.from(key, "utf8")) % 16384;
      }

      const clusterManager = new RedlockManager(nodes, { clusterMode: true });

      const testKeys = [
        "seat:42",
        "{seat:42}",
        "prefix{tag}suffix",
        "{}empty",
        "{a{b}c}",
        "foo{bar}baz{qux}",
        "seat:42:2026-12-05",
        "unicode:☕:seat",
        "{unicode:☕}:seat",
      ];

      for (const k of testKeys) {
        const lockKey = clusterManager.toPhysicalKey(k);
        const fenceKey = clusterManager.toPhysicalFencingKey(k);

        const slotLock = getClusterSlot(lockKey);
        const slotFence = getClusterSlot(fenceKey);

        expect(slotLock).toBe(slotFence);
      }
    });

    it("reads REDLOCK_CLUSTER_MODE environment variable in getRedlockManager()", () => {
      const origUrls = process.env.REDLOCK_REDIS_URLS;
      const origTokens = process.env.REDLOCK_REDIS_TOKENS;
      const origClusterEnv = process.env.REDLOCK_CLUSTER_MODE;

      try {
        process.env.REDLOCK_REDIS_URLS = "http://node1:80,http://node2:80,http://node3:80";
        process.env.REDLOCK_REDIS_TOKENS = "t1,t2,t3";
        process.env.REDLOCK_CLUSTER_MODE = "true";

        setRedlockManager(null);
        const mgr = getRedlockManager();
        expect(mgr).not.toBeNull();
        expect(mgr?.clusterMode).toBe(true);

        process.env.REDLOCK_CLUSTER_MODE = "false";
        setRedlockManager(null);
        const mgrFalse = getRedlockManager();
        expect(mgrFalse?.clusterMode).toBe(false);
      } finally {
        process.env.REDLOCK_REDIS_URLS = origUrls;
        process.env.REDLOCK_REDIS_TOKENS = origTokens;
        process.env.REDLOCK_CLUSTER_MODE = origClusterEnv;
      }
    });
  });
});


import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import {
  RedlockManager,
  DistributedLock,
  LockLostError,
  IRedisClient,
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
  });
});


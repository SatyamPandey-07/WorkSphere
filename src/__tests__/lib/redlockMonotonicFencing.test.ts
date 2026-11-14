import {
  acquireSeatWebLock,
  assertLockLeaseValid,
  computeDynamicClockDriftMs,
  getMonotonicNowNs,
  LockValidityError,
  nextMonotonicFencingToken,
  releaseSeatWebLock,
  resetMemorySeatLocks,
  resetMonotonicFencingSequence,
} from "@/lib/locks/seatHoldLock";

describe("Monotonic BigInt Fencing & Dynamic Clock Drift (#redlock)", () => {
  beforeEach(() => {
    resetMemorySeatLocks();
  });

  it("uses process.hrtime.bigint() for monotonic nanosecond timestamps", () => {
    const t1 = getMonotonicNowNs();
    const t2 = getMonotonicNowNs();

    expect(typeof t1).toBe("bigint");
    expect(typeof t2).toBe("bigint");
    expect(t2 >= t1).toBe(true);
  });

  it("generates strictly monotonic 64-bit BigInt fencing tokens past 32-bit wrap-around", () => {
    const beyond32Bit = BigInt("4294967296"); // 2^32
    resetMonotonicFencingSequence(beyond32Bit);

    const token1 = nextMonotonicFencingToken();
    const token2 = nextMonotonicFencingToken();
    const token3 = nextMonotonicFencingToken(token2 + BigInt(10));

    expect(typeof token1).toBe("bigint");
    expect(token1).toBe(beyond32Bit + BigInt(1));
    expect(token2).toBe(beyond32Bit + BigInt(2));
    expect(token3).toBe(beyond32Bit + BigInt(13));
  });

  it("computes dynamic clock drift from monotonic acquisition latency and node skew", () => {
    const fiveMsInNs = BigInt(5_000_000);
    const drift = computeDynamicClockDriftMs(10_000, fiveMsInNs, 15);

    // Base drift (100ms) vs overhead (ceil(2.5) + 15 = 18) -> max(100, 18) + 2 = 102ms
    expect(drift).toBeGreaterThanOrEqual(102);

    // Short TTL (1000ms -> 10ms base drift) with 15ms synthetic skew dynamically expands drift
    const shortTtlDrift = computeDynamicClockDriftMs(1_000, fiveMsInNs, 15);
    expect(shortTtlDrift).toBeGreaterThan(15);
  });

  it("tolerates synthetic 15ms multi-node clock skew without false LockValidityError", async () => {
    const res = await acquireSeatWebLock(
      "venue-1",
      "seat-A1",
      "user-1",
      "Soham",
      10,
    );

    expect(res.success).toBe(true);
    expect(res.lock).toBeDefined();
    expect(typeof res.fencingToken).toBe("bigint");
    expect((res.driftAllowanceMs ?? 0) >= 100).toBe(true);

    // Simulate 15ms inter-node clock skew immediately after acquisition
    const validation = assertLockLeaseValid(res.lock!, {
      observedSkewMs: 15,
    });

    expect(validation.valid).toBe(true);
    expect(validation.remainingValidityMs).toBeGreaterThan(9_000);
    expect(validation.fencingToken).toBe(res.fencingToken);

    await releaseSeatWebLock("venue-1", "seat-A1", "user-1");
  });

  it("throws LockValidityError when monotonic elapsed time exceeds TTL and drift allowance", async () => {
    const res = await acquireSeatWebLock(
      "venue-1",
      "seat-B2",
      "user-1",
      "Soham",
      10,
    );
    expect(res.success).toBe(true);

    const startNs = BigInt(res.lock!.acquiredMonotonicNs!);
    // Advance monotonic clock by 12 seconds (> 10s TTL + drift allowance)
    const expiredNs = startNs + BigInt(12_000_000_000);

    expect(() =>
      assertLockLeaseValid(res.lock!, {
        nowMonotonicNs: expiredNs,
        observedSkewMs: 15,
      }),
    ).toThrow(LockValidityError);
  });

  it("issues strictly increasing BigInt fencing tokens across rapid concurrent seat lock cycles", async () => {
    const tokens: bigint[] = [];

    for (let i = 0; i < 5; i++) {
      const acq = await acquireSeatWebLock("venue-1", `seat-${i}`, `user-${i}`);
      expect(acq.success).toBe(true);
      expect(typeof acq.fencingToken).toBe("bigint");
      tokens.push(acq.fencingToken!);
      await releaseSeatWebLock("venue-1", `seat-${i}`, `user-${i}`);
    }

    for (let i = 1; i < tokens.length; i++) {
      expect(tokens[i] > tokens[i - 1]).toBe(true);
    }
  });
});

import {
  acquireQuorumFencingToken,
  configureRedlockNodes,
  QuorumFencingError,
  StaleFencingTokenError,
  verifyAndAdvanceDbFencingToken,
  type RedlockRedisNode,
} from "@/lib/locks/seatHoldLock";

describe("Redlock N/2+1 Quorum INCR Fencing & Partition Failover Monotonicity", () => {
  beforeEach(() => {
    resetMemorySeatLocks();
  });

  function createMockRedisNode(
    id: string,
    initialSeq: number,
    options: { partitioned?: boolean } = {},
  ): RedlockRedisNode & {
    store: Map<string, number>;
    partitioned: boolean;
  } {
    const store = new Map<string, number>();
    return {
      id,
      store,
      partitioned: options.partitioned ?? false,
      async incr(key: string) {
        if (this.partitioned) {
          throw new Error(
            `ECONNREFUSED: Redis node ${id} is network partitioned`,
          );
        }
        const next = (store.get(key) ?? initialSeq) + 1;
        store.set(key, next);
        return next;
      },
      async set(key: string, val: string) {
        if (!this.partitioned) {
          store.set(key, Number(val));
        }
      },
    };
  }

  it("maintains strict token monotonicity when Master A (1042) partitions and lagging Replica B (1040) is promoted", async () => {
    // 3-node Redlock cluster: Master A is at 1041, Replica B lags at 1039, Witness C is at 1041
    const masterA = createMockRedisNode("master-A", 1041);
    const replicaB = createMockRedisNode("replica-B", 1039);
    const witnessC = createMockRedisNode("witness-C", 1041);

    const nodes = [masterA, replicaB, witnessC];
    configureRedlockNodes(nodes);

    // Step 1: Acquire seat lock before partition -> Master A & Witness C increment to 1042
    const lock1 = await acquireSeatWebLock(
      "venue-9",
      "seat-12",
      "user-alpha",
      "Alpha",
      60,
    );
    expect(lock1.success).toBe(true);
    expect(lock1.fencingToken).toBe(BigInt(1042));

    // Step 2: Simulate network partition isolating Master A before replication completes
    masterA.partitioned = true;
    await releaseSeatWebLock("venue-9", "seat-12", "user-alpha");

    // Step 3: Replica B is promoted to Master (local counter was lagging at 1040, Witness C is at 1042)
    // N/2+1 quorum (Replica B + Witness C) guarantees token > 1042 (never 1040!)
    const lock2 = await acquireSeatWebLock(
      "venue-9",
      "seat-12",
      "user-beta",
      "Beta",
      60,
    );
    expect(lock2.success).toBe(true);
    expect(lock2.fencingToken).toBeGreaterThan(lock1.fencingToken!);
    expect(lock2.fencingToken).toBe(BigInt(1043));
  });

  it("rejects lock acquisition with QUORUM_FAILED when fewer than N/2+1 Redis nodes respond", async () => {
    const node1 = createMockRedisNode("redis-1", 100, { partitioned: false });
    const node2 = createMockRedisNode("redis-2", 100, { partitioned: true });
    const node3 = createMockRedisNode("redis-3", 100, { partitioned: true });

    await expect(
      acquireQuorumFencingToken("venue-9:seat-99", [node1, node2, node3]),
    ).rejects.toBeInstanceOf(QuorumFencingError);

    const res = await acquireSeatWebLock(
      "venue-9",
      "seat-99",
      "user-alpha",
      "Alpha",
      60,
      [node1, node2, node3],
    );
    expect(res.success).toBe(false);
    expect(res.reason).toBe("QUORUM_FAILED");
  });

  it("enforces token > last_seen_token in database transaction check and rejects stale tokens", async () => {
    let dbLastSeenToken: bigint | null = null;
    const dbStore = {
      getLastSeenToken: jest.fn(async () => dbLastSeenToken),
      saveLastSeenToken: jest.fn(async (_key: string, token: bigint) => {
        dbLastSeenToken = token;
      }),
    };

    // Valid token 1042 is accepted and persisted
    const first = await verifyAndAdvanceDbFencingToken(
      "venue-9:seat-12",
      BigInt(1042),
      dbStore,
    );
    expect(first.accepted).toBe(true);
    expect(first.token).toBe(BigInt(1042));

    // Stale token 1040 (from lagging replica) is rejected
    await expect(
      verifyAndAdvanceDbFencingToken("venue-9:seat-12", BigInt(1040), dbStore),
    ).rejects.toBeInstanceOf(StaleFencingTokenError);

    // Equal token 1042 (duplicate/replayed request) is also rejected
    await expect(
      verifyAndAdvanceDbFencingToken("venue-9:seat-12", BigInt(1042), dbStore),
    ).rejects.toBeInstanceOf(StaleFencingTokenError);

    // Strictly higher token 1043 succeeds
    const second = await verifyAndAdvanceDbFencingToken(
      "venue-9:seat-12",
      BigInt(1043),
      dbStore,
    );
    expect(second.accepted).toBe(true);
    expect(second.previousToken).toBe(BigInt(1042));
  });
});

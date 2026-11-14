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

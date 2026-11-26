jest.mock("@/lib/redis", () => ({
  getRedis: jest.fn().mockReturnValue(null),
}));

import {
  acquireSeatWebLock,
  extendSeatHold,
  getSeatWebLock,
  resetMemorySeatLocks,
} from "@/lib/locks/seatHoldLock";

describe("extendSeatHold", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-11-19T12:00:00.000Z"));
    resetMemorySeatLocks();
  });

  afterEach(() => {
    resetMemorySeatLocks();
    jest.useRealTimers();
  });

  async function acquire(ttlSeconds = 300) {
    const result = await acquireSeatWebLock(
      "venue-a",
      "seat-10",
      "user-a",
      "Alice",
      ttlSeconds,
    );
    expect(result.success).toBe(true);
    expect(result.lock?.fencingToken).toBeDefined();
    return result.lock!;
  }

  it("extends the holder's lease by exactly five minutes once", async () => {
    const original = await acquire(300);
    const extended = await extendSeatHold(
      "venue-a",
      "seat-10",
      "user-a",
      original.fencingToken!,
    );

    expect(extended.success).toBe(true);
    expect(extended.lock?.expiresAt).toBe(original.expiresAt + 300_000);
    expect(extended.lock?.extensionUsed).toBe(true);
    expect(extended.lock?.version).toBe(original.version + 1);

    const secondAttempt = await extendSeatHold(
      "venue-a",
      "seat-10",
      "user-a",
      original.fencingToken!,
    );
    expect(secondAttempt).toEqual({
      success: false,
      reason: "ALREADY_EXTENDED",
    });
  });

  it("rejects an invalid fencing token and another user's extension", async () => {
    const original = await acquire();

    await expect(
      extendSeatHold("venue-a", "seat-10", "user-a", "wrong-token"),
    ).resolves.toMatchObject({
      success: false,
      reason: "UNAUTHORIZED",
    });

    await expect(
      extendSeatHold("venue-a", "seat-10", "user-b", original.fencingToken!),
    ).resolves.toMatchObject({
      success: false,
      reason: "UNAUTHORIZED",
    });

    expect((await getSeatWebLock("venue-a", "seat-10"))?.expiresAt).toBe(
      original.expiresAt,
    );
  });

  it("requires more than sixty seconds remaining", async () => {
    const original = await acquire(61);
    jest.advanceTimersByTime(1_000);

    const result = await extendSeatHold(
      "venue-a",
      "seat-10",
      "user-a",
      original.fencingToken!,
    );

    expect(result.success).toBe(false);
    expect(result.reason).toBe("TOO_CLOSE_TO_EXPIRY");
    expect(result.remainingSeconds).toBe(60);
  });

  it("rejects a lease that has already expired", async () => {
    const original = await acquire(10);
    jest.advanceTimersByTime(10_001);

    await expect(
      extendSeatHold("venue-a", "seat-10", "user-a", original.fencingToken!),
    ).resolves.toEqual({
      success: false,
      reason: "NOT_FOUND",
    });
  });

  it("does not allow a missing token", async () => {
    const result = await extendSeatHold("venue-a", "seat-10", "user-a", "");
    expect(result).toEqual({ success: false, reason: "UNAUTHORIZED" });
  });
});

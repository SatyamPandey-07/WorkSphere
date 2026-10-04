jest.mock("@/lib/redis", () => ({
  getRedis: jest.fn().mockReturnValue(null),
}));

import {
  acquireSeatWebLock,
  releaseSeatWebLock,
  getSeatWebLock,
  resetMemorySeatLocks,
} from "@/lib/locks/seatHoldLock";

describe("Distributed SeatHoldLock Library & Redis WebLocks (#3522)", () => {
  beforeEach(() => {
    resetMemorySeatLocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    resetMemorySeatLocks();
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it("successfully acquires lock when seat is unheld", async () => {
    const result = await acquireSeatWebLock(
      "venue-alpha",
      "seat-10",
      "user-1",
      "Alice",
      300,
    );

    expect(result.success).toBe(true);
    expect(result.lock?.seatId).toBe("seat-10");
    expect(result.lock?.userId).toBe("user-1");
    expect(result.lock?.userName).toBe("Alice");

    const currentLock = await getSeatWebLock("venue-alpha", "seat-10");
    expect(currentLock).not.toBeNull();
    expect(currentLock?.userId).toBe("user-1");
  });

  it("prevents double-booking when second user attempts to hold same seat", async () => {
    await acquireSeatWebLock("venue-alpha", "seat-10", "user-1", "Alice", 300);

    const result2 = await acquireSeatWebLock(
      "venue-alpha",
      "seat-10",
      "user-2",
      "Bob",
      300,
    );

    expect(result2.success).toBe(false);
    expect(result2.reason).toBe("ALREADY_HELD");
    expect(result2.heldBy).toBe("user-1");
    expect(result2.heldByName).toBe("Alice");
    expect(result2.remainingSeconds).toBeGreaterThan(0);
  });

  it("allows lease renewal by the holding user", async () => {
    const res1 = await acquireSeatWebLock(
      "venue-alpha",
      "seat-10",
      "user-1",
      "Alice",
      300,
    );
    expect(res1.lock?.version).toBe(1);

    // Advance 60 seconds
    jest.advanceTimersByTime(60_000);

    const res2 = await acquireSeatWebLock(
      "venue-alpha",
      "seat-10",
      "user-1",
      "Alice",
      300,
    );
    expect(res2.success).toBe(true);
    expect(res2.lock?.version).toBe(2);
  });

  it("releases lock only when caller matches holding user", async () => {
    await acquireSeatWebLock("venue-alpha", "seat-10", "user-1", "Alice", 300);

    // Unauthorized release by user-2 fails
    const releasedByBob = await releaseSeatWebLock(
      "venue-alpha",
      "seat-10",
      "user-2",
    );
    expect(releasedByBob).toBe(false);

    const stillHeld = await getSeatWebLock("venue-alpha", "seat-10");
    expect(stillHeld?.userId).toBe("user-1");

    // Authorized release by user-1 succeeds
    const releasedByAlice = await releaseSeatWebLock(
      "venue-alpha",
      "seat-10",
      "user-1",
    );
    expect(releasedByAlice).toBe(true);

    const afterRelease = await getSeatWebLock("venue-alpha", "seat-10");
    expect(afterRelease).toBeNull();
  });

  it("automatically expires lock when TTL elapses", async () => {
    await acquireSeatWebLock("venue-alpha", "seat-10", "user-1", "Alice", 300);

    // 4 minutes later: still held
    jest.advanceTimersByTime(240_000);
    expect(await getSeatWebLock("venue-alpha", "seat-10")).not.toBeNull();

    // 5 minutes and 1 second later: expired
    jest.advanceTimersByTime(61_000);
    expect(await getSeatWebLock("venue-alpha", "seat-10")).toBeNull();

    // Another user can now acquire lock
    const res = await acquireSeatWebLock(
      "venue-alpha",
      "seat-10",
      "user-2",
      "Bob",
      300,
    );
    expect(res.success).toBe(true);
  });
});

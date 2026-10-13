jest.mock("@/lib/redis", () => ({
  getRedis: jest.fn().mockReturnValue(null),
}));

import {
  acquireSeatWebLock,
  releaseSeatWebLock,
  getSeatWebLock,
  resetMemorySeatLocks,
  withSeatWebLock,
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

  describe("withSeatWebLock Timeout Fallback & Abort Handling (#4921)", () => {
    const originalNavigator = global.navigator;

    afterEach(() => {
      Object.defineProperty(global, "navigator", {
        value: originalNavigator,
        configurable: true,
        writable: true,
      });
    });

    it("runs callback immediately when navigator.locks is unavailable", async () => {
      Object.defineProperty(global, "navigator", {
        value: {},
        configurable: true,
        writable: true,
      });

      let executed = false;
      const result = await withSeatWebLock("v1", "s1", async (release) => {
        executed = true;
        release();
        return "SUCCESS";
      });

      expect(executed).toBe(true);
      expect(result).toBe("SUCCESS");
    });

    it("acquires exclusive lock successfully via navigator.locks when available", async () => {
      let requestedLockName = "";
      const mockRequest = jest.fn((name, options, cb) => {
        requestedLockName = name;
        return cb();
      });

      Object.defineProperty(global, "navigator", {
        value: {
          locks: {
            request: mockRequest,
          },
        },
        configurable: true,
        writable: true,
      });

      const res = await withSeatWebLock("v1", "s1", async (release) => {
        release();
        return "LOCK_ACQUIRED";
      });

      expect(res).toBe("LOCK_ACQUIRED");
      expect(mockRequest).toHaveBeenCalled();
      expect(requestedLockName).toBe("seat-hold:v1:s1");
    });

    it("times out and aborts when navigator.locks.request hangs indefinitely", async () => {
      // Mock request that never fulfills
      let abortSignalPassed: AbortSignal | undefined;
      const hangingMockRequest = jest.fn((name, options, cb) => {
        abortSignalPassed = options?.signal;
        return new Promise(() => {}); // never resolves
      });

      Object.defineProperty(global, "navigator", {
        value: {
          locks: {
            request: hangingMockRequest,
          },
        },
        configurable: true,
        writable: true,
      });

      // Use real timers for the timeout race test
      jest.useRealTimers();

      await expect(
        withSeatWebLock(
          "v1",
          "s1",
          async () => "SHOULD_NOT_REACH",
          { timeoutMs: 50 } // fast 50ms timeout for test
        )
      ).rejects.toThrow(/Web Lock acquisition timed out after 50ms/);

      expect(abortSignalPassed?.aborted).toBe(true);
    });
  });
});


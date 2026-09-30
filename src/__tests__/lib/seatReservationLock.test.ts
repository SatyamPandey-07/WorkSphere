/**
 * Tests for seat reservation lock (optimistic concurrency).
 */

interface SeatLock {
  seatId: string;
  userId: string;
  acquiredAt: number;
  ttlMs: number;
}

function isLockActive(lock: SeatLock, nowMs: number): boolean {
  return nowMs < lock.acquiredAt + lock.ttlMs;
}

function canAcquire(
  lock: SeatLock | null,
  userId: string,
  nowMs: number
): boolean {
  if (lock === null) return true;
  if (!isLockActive(lock, nowMs)) return true;
  return lock.userId === userId; // same user can re-acquire
}

function acquireLock(
  seatId: string,
  userId: string,
  nowMs: number,
  ttlMs = 300_000
): SeatLock {
  return { seatId, userId, acquiredAt: nowMs, ttlMs };
}

function releaseLock(lock: SeatLock, userId: string): SeatLock | null {
  if (lock.userId !== userId) return lock; // only lock owner can release
  return null;
}

const NOW = 1_700_000_000_000;
const LOCK: SeatLock = { seatId: "s1", userId: "u1", acquiredAt: NOW, ttlMs: 300_000 };

describe("Seat reservation lock", () => {
  it("lock is active within TTL", () => {
    expect(isLockActive(LOCK, NOW + 100_000)).toBe(true);
  });

  it("lock expires after TTL", () => {
    expect(isLockActive(LOCK, NOW + 300_000)).toBe(false);
  });

  it("null lock → can acquire", () => {
    expect(canAcquire(null, "u2", NOW)).toBe(true);
  });

  it("active lock by other user → cannot acquire", () => {
    expect(canAcquire(LOCK, "u2", NOW + 100)).toBe(false);
  });

  it("expired lock → can acquire by anyone", () => {
    expect(canAcquire(LOCK, "u2", NOW + 400_000)).toBe(true);
  });

  it("same user can re-acquire own active lock", () => {
    expect(canAcquire(LOCK, "u1", NOW + 100)).toBe(true);
  });

  it("acquireLock creates lock with correct fields", () => {
    const lock = acquireLock("s2", "u3", NOW);
    expect(lock.seatId).toBe("s2");
    expect(lock.userId).toBe("u3");
    expect(lock.ttlMs).toBe(300_000);
  });

  it("releaseLock by owner → null", () => {
    expect(releaseLock(LOCK, "u1")).toBeNull();
  });

  it("releaseLock by non-owner → lock unchanged", () => {
    expect(releaseLock(LOCK, "u2")).toEqual(LOCK);
  });
});

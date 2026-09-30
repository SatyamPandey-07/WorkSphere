/**
 * Tests for venue booking concurrency control mechanisms.
 */

interface BookingLock {
  lockId: string;
  resourceId: string;     // seatId or slotId
  holderId: string;       // userId holding the lock
  acquiredAt: number;
  expiresAt: number;
  lockType: "shared" | "exclusive";
}

function canAcquireLock(
  locks: BookingLock[],
  resourceId: string,
  holderId: string,
  lockType: "shared" | "exclusive",
  nowMs: number
): boolean {
  const activeLocks = locks.filter(
    (l) => l.resourceId === resourceId && nowMs < l.expiresAt
  );

  if (activeLocks.length === 0) return true;

  if (lockType === "exclusive") {
    return activeLocks.every((l) => l.holderId === holderId);
  }

  // Shared: ok if no exclusive locks from others
  return activeLocks.every((l) => l.lockType === "shared" || l.holderId === holderId);
}

function releaseLock(locks: BookingLock[], lockId: string): BookingLock[] {
  return locks.filter((l) => l.lockId !== lockId);
}

function cleanExpiredLocks(locks: BookingLock[], nowMs: number): BookingLock[] {
  return locks.filter((l) => nowMs < l.expiresAt);
}

function activeLockCount(locks: BookingLock[], resourceId: string, nowMs: number): number {
  return locks.filter((l) => l.resourceId === resourceId && nowMs < l.expiresAt).length;
}

function lockWaitTime(
  locks: BookingLock[],
  resourceId: string,
  nowMs: number
): number {
  const active = locks.filter((l) => l.resourceId === resourceId && nowMs < l.expiresAt);
  if (active.length === 0) return 0;
  const maxExpiry = Math.max(...active.map((l) => l.expiresAt));
  return Math.max(0, maxExpiry - nowMs);
}

const NOW = 1_700_000_000_000;
const LOCKS: BookingLock[] = [
  { lockId: "l1", resourceId: "s1", holderId: "u1", acquiredAt: NOW - 1000, expiresAt: NOW + 30_000, lockType: "exclusive" },
  { lockId: "l2", resourceId: "s2", holderId: "u2", acquiredAt: NOW - 500,  expiresAt: NOW + 60_000, lockType: "shared"    },
];

describe("Booking concurrency control", () => {
  it("canAcquireLock: exclusive lock by another → false", () => {
    expect(canAcquireLock(LOCKS, "s1", "u2", "shared", NOW)).toBe(false);
  });

  it("canAcquireLock: same holder already has exclusive → true", () => {
    expect(canAcquireLock(LOCKS, "s1", "u1", "exclusive", NOW)).toBe(true);
  });

  it("canAcquireLock: shared lock, another shared → true", () => {
    expect(canAcquireLock(LOCKS, "s2", "u3", "shared", NOW)).toBe(true);
  });

  it("canAcquireLock: no locks → true", () => {
    expect(canAcquireLock(LOCKS, "s99", "u1", "exclusive", NOW)).toBe(true);
  });

  it("releaseLock: removes the lock", () => {
    const updated = releaseLock(LOCKS, "l1");
    expect(updated.find((l) => l.lockId === "l1")).toBeUndefined();
    expect(updated).toHaveLength(1);
  });

  it("cleanExpiredLocks: removes expired locks", () => {
    const withExpired = [
      ...LOCKS,
      { ...LOCKS[0], lockId: "l3", expiresAt: NOW - 1 },
    ];
    const cleaned = cleanExpiredLocks(withExpired, NOW);
    expect(cleaned).toHaveLength(2);
  });

  it("lockWaitTime: wait until max expiry", () => {
    expect(lockWaitTime(LOCKS, "s1", NOW)).toBe(30_000);
  });

  it("lockWaitTime: no locks → 0", () => {
    expect(lockWaitTime(LOCKS, "s99", NOW)).toBe(0);
  });
});

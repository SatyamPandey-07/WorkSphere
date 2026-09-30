/**
 * Tests for venue smart lock access code management.
 */

interface SmartLockAccess {
  lockId: string;
  venueId: string;
  accessCode: string;
  userId: string;
  validFromMs: number;
  validUntilMs: number;
  maxUses: number;
  usedCount: number;
  revokedAt: number | null;
}

function isAccessValid(access: SmartLockAccess, nowMs: number): boolean {
  if (access.revokedAt !== null) return false;
  if (nowMs < access.validFromMs || nowMs >= access.validUntilMs) return false;
  if (access.usedCount >= access.maxUses) return false;
  return true;
}

function recordUsage(access: SmartLockAccess): SmartLockAccess {
  if (!isAccessValid(access, Date.now())) throw new Error("Access not valid");
  return { ...access, usedCount: access.usedCount + 1 };
}

function revokeAccess(access: SmartLockAccess, nowMs: number): SmartLockAccess {
  return { ...access, revokedAt: nowMs };
}

function remainingUses(access: SmartLockAccess): number {
  return Math.max(0, access.maxUses - access.usedCount);
}

function activeAccessForUser(
  accesses: SmartLockAccess[],
  userId: string,
  nowMs: number
): SmartLockAccess[] {
  return accesses.filter(
    (a) => a.userId === userId && isAccessValid(a, nowMs)
  );
}

const NOW = 1_700_000_000_000;
const ACCESS: SmartLockAccess = {
  lockId: "lock1", venueId: "v1", accessCode: "1234",
  userId: "u1", validFromMs: NOW - 3600_000, validUntilMs: NOW + 3600_000,
  maxUses: 3, usedCount: 1, revokedAt: null,
};

describe("Venue smart lock access", () => {
  it("isAccessValid: within window and not exhausted → true", () => {
    expect(isAccessValid(ACCESS, NOW)).toBe(true);
  });

  it("isAccessValid: before valid window → false", () => {
    expect(isAccessValid(ACCESS, ACCESS.validFromMs - 1)).toBe(false);
  });

  it("isAccessValid: revoked → false", () => {
    const revoked = revokeAccess(ACCESS, NOW - 100);
    expect(isAccessValid(revoked, NOW)).toBe(false);
  });

  it("isAccessValid: max uses reached → false", () => {
    expect(isAccessValid({ ...ACCESS, usedCount: 3 }, NOW)).toBe(false);
  });

  it("revokeAccess: sets revokedAt", () => {
    expect(revokeAccess(ACCESS, NOW).revokedAt).toBe(NOW);
  });

  it("revokeAccess is immutable", () => {
    revokeAccess(ACCESS, NOW);
    expect(ACCESS.revokedAt).toBeNull();
  });

  it("remainingUses: 3 max - 1 used = 2", () => {
    expect(remainingUses(ACCESS)).toBe(2);
  });

  it("remainingUses: clamps to 0", () => {
    expect(remainingUses({ ...ACCESS, usedCount: 10 })).toBe(0);
  });

  it("activeAccessForUser: returns valid access", () => {
    const all = [ACCESS, { ...ACCESS, lockId: "lock2", revokedAt: NOW - 1 }];
    const active = activeAccessForUser(all, "u1", NOW);
    expect(active).toHaveLength(1);
  });
});

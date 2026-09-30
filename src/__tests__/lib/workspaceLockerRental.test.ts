/**
 * Tests for workspace locker rental management.
 */

type LockerSize = "small" | "medium" | "large";

interface LockerRental {
  lockerId: string;
  size: LockerSize;
  userId: string | null;
  rentedAt: number | null;
  expiresAt: number | null;
}

function isLockerAvailable(locker: LockerRental, nowMs: number): boolean {
  if (locker.userId === null) return true;
  if (locker.expiresAt !== null && nowMs >= locker.expiresAt) return true;
  return false;
}

function rentLocker(
  locker: LockerRental,
  userId: string,
  durationMs: number,
  nowMs: number
): LockerRental {
  if (!isLockerAvailable(locker, nowMs)) throw new Error("Locker not available");
  return { ...locker, userId, rentedAt: nowMs, expiresAt: nowMs + durationMs };
}

function releaseLocker(locker: LockerRental): LockerRental {
  return { ...locker, userId: null, rentedAt: null, expiresAt: null };
}

function lockerRentalCost(size: LockerSize, durationHours: number): number {
  const hourlyRate: Record<LockerSize, number> = { small: 100, medium: 200, large: 300 }; // cents
  return hourlyRate[size] * durationHours;
}

const NOW = 1_700_000_000_000;
const FREE_LOCKER: LockerRental = { lockerId: "L1", size: "medium", userId: null, rentedAt: null, expiresAt: null };
const RENTED_LOCKER: LockerRental = { lockerId: "L2", size: "small", userId: "u1", rentedAt: NOW - 3600_000, expiresAt: NOW + 3600_000 };

describe("Workspace locker rental", () => {
  it("free locker is available", () => {
    expect(isLockerAvailable(FREE_LOCKER, NOW)).toBe(true);
  });

  it("rented locker is not available", () => {
    expect(isLockerAvailable(RENTED_LOCKER, NOW)).toBe(false);
  });

  it("expired locker is available again", () => {
    expect(isLockerAvailable(RENTED_LOCKER, NOW + 4_000_000)).toBe(true);
  });

  it("rentLocker assigns user and expiry", () => {
    const rented = rentLocker(FREE_LOCKER, "u2", 3_600_000, NOW);
    expect(rented.userId).toBe("u2");
    expect(rented.expiresAt).toBe(NOW + 3_600_000);
  });

  it("rentLocker throws when not available", () => {
    expect(() => rentLocker(RENTED_LOCKER, "u2", 3_600_000, NOW)).toThrow();
  });

  it("releaseLocker clears user and times", () => {
    const released = releaseLocker(RENTED_LOCKER);
    expect(released.userId).toBeNull();
    expect(released.expiresAt).toBeNull();
  });

  it("lockerRentalCost: small 2h = 200 cents", () => {
    expect(lockerRentalCost("small", 2)).toBe(200);
  });

  it("lockerRentalCost: large 3h = 900 cents", () => {
    expect(lockerRentalCost("large", 3)).toBe(900);
  });
});

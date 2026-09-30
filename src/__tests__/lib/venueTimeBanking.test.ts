/**
 * Tests for venue time banking system (earned hours for community contributions).
 */

interface TimeBank {
  userId: string;
  venueId: string;
  earnedHours: number;    // hours earned through volunteering/contributions
  spentHours: number;     // hours used for free workspace
  expiryDate: string;     // YYYY-MM-DD
}

function availableHours(bank: TimeBank): number {
  return Math.max(0, bank.earnedHours - bank.spentHours);
}

function isBankExpired(bank: TimeBank, todayStr: string): boolean {
  return todayStr > bank.expiryDate;
}

function canUseHours(bank: TimeBank, hoursNeeded: number, todayStr: string): boolean {
  if (isBankExpired(bank, todayStr)) return false;
  return availableHours(bank) >= hoursNeeded;
}

function useHours(bank: TimeBank, hoursUsed: number, todayStr: string): TimeBank {
  if (!canUseHours(bank, hoursUsed, todayStr)) throw new Error("Insufficient hours or expired bank");
  return { ...bank, spentHours: bank.spentHours + hoursUsed };
}

function earnHours(bank: TimeBank, hoursEarned: number): TimeBank {
  if (hoursEarned <= 0) throw new Error("Must earn positive hours");
  return { ...bank, earnedHours: bank.earnedHours + hoursEarned };
}

function hoursBankValue(bank: TimeBank, hourlyRateCents: number): number {
  return availableHours(bank) * hourlyRateCents;
}

const BANK: TimeBank = {
  userId: "u1", venueId: "v1",
  earnedHours: 20, spentHours: 8,
  expiryDate: "2027-12-31",
};

describe("Venue time banking system", () => {
  it("availableHours: 20-8 = 12", () => {
    expect(availableHours(BANK)).toBe(12);
  });

  it("isBankExpired: future date → false", () => {
    expect(isBankExpired(BANK, "2026-10-01")).toBe(false);
  });

  it("isBankExpired: past expiry → true", () => {
    expect(isBankExpired(BANK, "2028-01-01")).toBe(true);
  });

  it("canUseHours: 10h from 12 available → true", () => {
    expect(canUseHours(BANK, 10, "2026-10-01")).toBe(true);
  });

  it("canUseHours: 15h from 12 available → false", () => {
    expect(canUseHours(BANK, 15, "2026-10-01")).toBe(false);
  });

  it("useHours: reduces spentHours", () => {
    const updated = useHours(BANK, 4, "2026-10-01");
    expect(updated.spentHours).toBe(12);
  });

  it("useHours: throws when expired", () => {
    expect(() => useHours(BANK, 1, "2028-01-01")).toThrow("expired bank");
  });

  it("earnHours: increases earnedHours", () => {
    const updated = earnHours(BANK, 5);
    expect(updated.earnedHours).toBe(25);
  });

  it("earnHours: throws for non-positive", () => {
    expect(() => earnHours(BANK, 0)).toThrow("positive");
  });

  it("hoursBankValue: 12h × 500 cents = 6000", () => {
    expect(hoursBankValue(BANK, 500)).toBe(6000);
  });
});

/**
 * Tests for reward point expiry and balance calculation.
 */

interface RewardTransaction {
  id: string;
  userId: string;
  points: number;      // positive = earned, negative = spent
  type: "earn" | "spend" | "expire";
  createdAt: number;
  expiresAt?: number;  // only for earn transactions
}

function earnedPoints(txns: RewardTransaction[], userId: string): number {
  return txns
    .filter((t) => t.userId === userId && t.type === "earn")
    .reduce((sum, t) => sum + t.points, 0);
}

function spentPoints(txns: RewardTransaction[], userId: string): number {
  return txns
    .filter((t) => t.userId === userId && t.type === "spend")
    .reduce((sum, t) => sum + Math.abs(t.points), 0);
}

function expiredPoints(txns: RewardTransaction[], userId: string, nowMs: number): number {
  return txns
    .filter(
      (t) => t.userId === userId && t.type === "earn" && t.expiresAt !== undefined && t.expiresAt <= nowMs
    )
    .reduce((sum, t) => sum + t.points, 0);
}

function availableBalance(txns: RewardTransaction[], userId: string, nowMs: number): number {
  return Math.max(0, earnedPoints(txns, userId) - spentPoints(txns, userId) - expiredPoints(txns, userId, nowMs));
}

const NOW = 1_700_000_000_000;
const TXNS: RewardTransaction[] = [
  { id: "t1", userId: "u1", points:  500, type: "earn",   createdAt: NOW - 7200_000, expiresAt: NOW + 86400_000 },
  { id: "t2", userId: "u1", points:  200, type: "earn",   createdAt: NOW - 3600_000, expiresAt: NOW - 1000 }, // expired
  { id: "t3", userId: "u1", points: -100, type: "spend",  createdAt: NOW - 1800_000 },
  { id: "t4", userId: "u2", points:  300, type: "earn",   createdAt: NOW - 600_000  },
];

describe("Reward point expiry and balance", () => {
  it("earnedPoints: u1 total = 700", () => {
    expect(earnedPoints(TXNS, "u1")).toBe(700);
  });

  it("spentPoints: u1 = 100", () => {
    expect(spentPoints(TXNS, "u1")).toBe(100);
  });

  it("expiredPoints: u1 expired 200", () => {
    expect(expiredPoints(TXNS, "u1", NOW)).toBe(200);
  });

  it("expiredPoints: u1 = 0 if now before expiry", () => {
    expect(expiredPoints(TXNS, "u1", NOW - 2000)).toBe(0);
  });

  it("availableBalance: 700 earned - 100 spent - 200 expired = 400", () => {
    expect(availableBalance(TXNS, "u1", NOW)).toBe(400);
  });

  it("availableBalance: u2 no spend/expire = 300", () => {
    expect(availableBalance(TXNS, "u2", NOW)).toBe(300);
  });

  it("availableBalance: clamps to 0", () => {
    const overspend: RewardTransaction = { id: "t5", userId: "u1", points: -1000, type: "spend", createdAt: NOW };
    expect(availableBalance([...TXNS, overspend], "u1", NOW)).toBe(0);
  });
});

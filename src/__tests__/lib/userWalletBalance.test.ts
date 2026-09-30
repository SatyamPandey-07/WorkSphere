/**
 * Tests for user in-app wallet balance management.
 */

interface WalletTransaction {
  id: string;
  userId: string;
  amountCents: number;  // positive = credit, negative = debit
  type: "topup" | "booking_payment" | "refund" | "reward";
  createdAt: number;
}

function walletBalance(transactions: WalletTransaction[], userId: string): number {
  return transactions
    .filter((t) => t.userId === userId)
    .reduce((sum, t) => sum + t.amountCents, 0);
}

function hasEnoughBalance(
  transactions: WalletTransaction[],
  userId: string,
  requiredCents: number
): boolean {
  return walletBalance(transactions, userId) >= requiredCents;
}

function transactionsByType(
  transactions: WalletTransaction[],
  userId: string,
  type: WalletTransaction["type"]
): WalletTransaction[] {
  return transactions.filter((t) => t.userId === userId && t.type === type);
}

function totalTopUps(transactions: WalletTransaction[], userId: string): number {
  return transactionsByType(transactions, userId, "topup")
    .reduce((sum, t) => sum + t.amountCents, 0);
}

const NOW = 1_700_000_000_000;
const TXN: WalletTransaction[] = [
  { id: "t1", userId: "u1", amountCents:  10000, type: "topup",           createdAt: NOW - 7200_000 },
  { id: "t2", userId: "u1", amountCents: -3000,  type: "booking_payment", createdAt: NOW - 3600_000 },
  { id: "t3", userId: "u1", amountCents:  500,   type: "reward",          createdAt: NOW - 1000     },
  { id: "t4", userId: "u2", amountCents:  5000,  type: "topup",           createdAt: NOW - 500      },
];

describe("User wallet balance", () => {
  it("walletBalance: 10000 - 3000 + 500 = 7500", () => {
    expect(walletBalance(TXN, "u1")).toBe(7500);
  });

  it("walletBalance: unknown user → 0", () => {
    expect(walletBalance(TXN, "u99")).toBe(0);
  });

  it("hasEnoughBalance: 7500 >= 5000 → true", () => {
    expect(hasEnoughBalance(TXN, "u1", 5000)).toBe(true);
  });

  it("hasEnoughBalance: 7500 >= 8000 → false", () => {
    expect(hasEnoughBalance(TXN, "u1", 8000)).toBe(false);
  });

  it("transactionsByType: u1 has 1 booking payment", () => {
    expect(transactionsByType(TXN, "u1", "booking_payment")).toHaveLength(1);
  });

  it("totalTopUps: u1 topped up 10000", () => {
    expect(totalTopUps(TXN, "u1")).toBe(10000);
  });

  it("totalTopUps: u2 topped up 5000", () => {
    expect(totalTopUps(TXN, "u2")).toBe(5000);
  });

  it("walletBalance: u2 = 5000", () => {
    expect(walletBalance(TXN, "u2")).toBe(5000);
  });
});

/**
 * Tests for booking security deposit management.
 */

interface DepositRecord {
  bookingId: string;
  userId: string;
  amountCents: number;
  paidAt: number | null;
  releasedAt: number | null;
  forfeitedAt: number | null;
}

type DepositStatus = "pending" | "held" | "released" | "forfeited";

function depositStatus(deposit: DepositRecord): DepositStatus {
  if (deposit.forfeitedAt) return "forfeited";
  if (deposit.releasedAt) return "released";
  if (deposit.paidAt)     return "held";
  return "pending";
}

function payDeposit(deposit: DepositRecord, nowMs: number): DepositRecord {
  if (deposit.paidAt) throw new Error("Deposit already paid");
  return { ...deposit, paidAt: nowMs };
}

function releaseDeposit(deposit: DepositRecord, nowMs: number): DepositRecord {
  if (!deposit.paidAt) throw new Error("Cannot release unpaid deposit");
  if (deposit.releasedAt || deposit.forfeitedAt) throw new Error("Deposit already settled");
  return { ...deposit, releasedAt: nowMs };
}

function forfeitDeposit(deposit: DepositRecord, nowMs: number): DepositRecord {
  if (!deposit.paidAt) throw new Error("Cannot forfeit unpaid deposit");
  if (deposit.releasedAt || deposit.forfeitedAt) throw new Error("Deposit already settled");
  return { ...deposit, forfeitedAt: nowMs };
}

const NOW = 1_700_000_000_000;
const UNPAID: DepositRecord = { bookingId: "b1", userId: "u1", amountCents: 5000, paidAt: null, releasedAt: null, forfeitedAt: null };
const HELD: DepositRecord = { ...UNPAID, paidAt: NOW - 3600_000 };

describe("Booking deposit management", () => {
  it("depositStatus: pending when not paid", () => {
    expect(depositStatus(UNPAID)).toBe("pending");
  });

  it("depositStatus: held when paid", () => {
    expect(depositStatus(HELD)).toBe("held");
  });

  it("depositStatus: released", () => {
    expect(depositStatus({ ...HELD, releasedAt: NOW })).toBe("released");
  });

  it("depositStatus: forfeited takes priority over released", () => {
    expect(depositStatus({ ...HELD, forfeitedAt: NOW })).toBe("forfeited");
  });

  it("payDeposit sets paidAt", () => {
    const paid = payDeposit(UNPAID, NOW);
    expect(paid.paidAt).toBe(NOW);
  });

  it("payDeposit throws if already paid", () => {
    expect(() => payDeposit(HELD, NOW)).toThrow("already paid");
  });

  it("releaseDeposit sets releasedAt", () => {
    const released = releaseDeposit(HELD, NOW);
    expect(released.releasedAt).toBe(NOW);
  });

  it("releaseDeposit throws on unpaid", () => {
    expect(() => releaseDeposit(UNPAID, NOW)).toThrow();
  });

  it("forfeitDeposit sets forfeitedAt", () => {
    const forfeited = forfeitDeposit(HELD, NOW);
    expect(forfeited.forfeitedAt).toBe(NOW);
  });

  it("forfeitDeposit throws on already released", () => {
    const released = { ...HELD, releasedAt: NOW };
    expect(() => forfeitDeposit(released, NOW)).toThrow("already settled");
  });
});

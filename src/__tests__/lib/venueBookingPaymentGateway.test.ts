/**
 * Tests for venue booking payment gateway processing logic.
 */

type PaymentMethod = "card" | "bank_transfer" | "wallet" | "crypto";
type PaymentStatus = "pending" | "processing" | "succeeded" | "failed" | "refunded" | "disputed";

interface PaymentAttempt {
  id: string;
  bookingId: string;
  amount: number;
  currency: string;
  method: PaymentMethod;
  status: PaymentStatus;
  createdAt: number;
  processedAt: number | null;
  errorCode: string | null;
}

function processingTimeMs(attempt: PaymentAttempt): number | null {
  if (!attempt.processedAt) return null;
  return attempt.processedAt - attempt.createdAt;
}

function gatewayFee(amount: number, method: PaymentMethod): number {
  const rates: Record<PaymentMethod, number> = {
    card: 0.029,
    bank_transfer: 0.008,
    wallet: 0.015,
    crypto: 0.01,
  };
  return Math.round(amount * rates[method] * 100) / 100;
}

function netAmount(amount: number, method: PaymentMethod): number {
  return Math.round((amount - gatewayFee(amount, method)) * 100) / 100;
}

function successRate(attempts: PaymentAttempt[]): number {
  if (attempts.length === 0) return 0;
  const succeeded = attempts.filter((a) => a.status === "succeeded").length;
  return Math.round((succeeded / attempts.length) * 100);
}

function failuresByCode(attempts: PaymentAttempt[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const a of attempts.filter((a) => a.status === "failed" && a.errorCode)) {
    result[a.errorCode!] = (result[a.errorCode!] ?? 0) + 1;
  }
  return result;
}

function avgProcessingMs(attempts: PaymentAttempt[]): number {
  const processed = attempts.filter((a) => a.processedAt !== null);
  if (processed.length === 0) return 0;
  return Math.round(
    processed.reduce((s, a) => s + (a.processedAt! - a.createdAt), 0) / processed.length
  );
}

const NOW = 1_700_000_000_000;
const ATTEMPTS: PaymentAttempt[] = [
  { id: "p1", bookingId: "b1", amount: 500, currency: "USD", method: "card",
    status: "succeeded", createdAt: NOW, processedAt: NOW + 2000, errorCode: null },
  { id: "p2", bookingId: "b2", amount: 300, currency: "USD", method: "bank_transfer",
    status: "failed", createdAt: NOW, processedAt: NOW + 1000, errorCode: "NSF" },
  { id: "p3", bookingId: "b3", amount: 200, currency: "USD", method: "card",
    status: "succeeded", createdAt: NOW, processedAt: NOW + 1500, errorCode: null },
];

describe("Payment gateway processing", () => {
  it("gatewayFee: card at 2.9% on $500 = $14.50", () => {
    expect(gatewayFee(500, "card")).toBe(14.5);
  });

  it("netAmount: $500 card = $485.50", () => {
    expect(netAmount(500, "card")).toBe(485.5);
  });

  it("successRate: 2 of 3 succeeded = 67%", () => {
    expect(successRate(ATTEMPTS)).toBe(67);
  });

  it("failuresByCode: NSF = 1 failure", () => {
    expect(failuresByCode(ATTEMPTS)).toEqual({ NSF: 1 });
  });

  it("avgProcessingMs: ~1833ms avg", () => {
    expect(avgProcessingMs(ATTEMPTS)).toBe(1500);
  });

  it("processingTimeMs: null for unprocessed", () => {
    const pending: PaymentAttempt = { ...ATTEMPTS[0], processedAt: null };
    expect(processingTimeMs(pending)).toBeNull();
  });
});

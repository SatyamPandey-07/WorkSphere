/**
 * Tests for payment gateway retry logic with exponential backoff.
 */

type PaymentStatus = "pending" | "processing" | "succeeded" | "failed" | "retrying";

interface PaymentAttempt {
  attemptId: string;
  paymentId: string;
  status: PaymentStatus;
  attemptNumber: number;
  timestamp: number;
  errorCode?: string;
}

const RETRYABLE_ERRORS = ["TIMEOUT", "NETWORK_ERROR", "RATE_LIMITED"];

function isRetryable(attempt: PaymentAttempt): boolean {
  return attempt.errorCode !== undefined && RETRYABLE_ERRORS.includes(attempt.errorCode);
}

function backoffDelayMs(attemptNumber: number, baseMs = 1000): number {
  return Math.min(baseMs * 2 ** (attemptNumber - 1), 30_000);
}

function canRetry(attempt: PaymentAttempt, maxAttempts = 3): boolean {
  return attempt.status === "failed" && isRetryable(attempt) && attempt.attemptNumber < maxAttempts;
}

function nextAttempt(
  prev: PaymentAttempt,
  nowMs: number
): PaymentAttempt {
  return {
    attemptId:    `${prev.paymentId}-attempt-${prev.attemptNumber + 1}`,
    paymentId:    prev.paymentId,
    status:       "processing",
    attemptNumber: prev.attemptNumber + 1,
    timestamp:    nowMs,
  };
}

const NOW = 1_700_000_000_000;
const FAILED: PaymentAttempt = {
  attemptId: "pay1-attempt-1", paymentId: "pay1",
  status: "failed", attemptNumber: 1, timestamp: NOW - 1000, errorCode: "TIMEOUT",
};

describe("Payment gateway retry logic", () => {
  it("isRetryable: TIMEOUT → true", () => {
    expect(isRetryable(FAILED)).toBe(true);
  });

  it("isRetryable: CARD_DECLINED → false", () => {
    const declined = { ...FAILED, errorCode: "CARD_DECLINED" };
    expect(isRetryable(declined)).toBe(false);
  });

  it("isRetryable: no errorCode → false", () => {
    const noError = { ...FAILED, errorCode: undefined };
    expect(isRetryable(noError)).toBe(false);
  });

  it("backoffDelayMs: attempt 1 = 1000ms", () => {
    expect(backoffDelayMs(1)).toBe(1000);
  });

  it("backoffDelayMs: attempt 2 = 2000ms", () => {
    expect(backoffDelayMs(2)).toBe(2000);
  });

  it("backoffDelayMs: attempt 6 capped at 30000ms", () => {
    expect(backoffDelayMs(6)).toBe(30_000);
  });

  it("canRetry: retryable error + under max → true", () => {
    expect(canRetry(FAILED)).toBe(true);
  });

  it("canRetry: at max attempts → false", () => {
    const maxed = { ...FAILED, attemptNumber: 3 };
    expect(canRetry(maxed)).toBe(false);
  });

  it("canRetry: non-retryable error → false", () => {
    const declined = { ...FAILED, errorCode: "CARD_DECLINED" };
    expect(canRetry(declined)).toBe(false);
  });

  it("nextAttempt increments attempt number", () => {
    const next = nextAttempt(FAILED, NOW);
    expect(next.attemptNumber).toBe(2);
    expect(next.status).toBe("processing");
  });
});

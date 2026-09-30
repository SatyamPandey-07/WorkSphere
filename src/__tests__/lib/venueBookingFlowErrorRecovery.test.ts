/**
 * Tests for booking flow error recovery strategies.
 */

type FlowError = "payment_declined" | "slot_taken" | "validation_failed" | "network_timeout" | "session_expired";

interface ErrorRecoveryConfig {
  maxRetries: number;
  retryDelayMs: number;
  escalateAfterAttempts: number;
  userMessageTemplate: string;
  requiresUserAction: boolean;
}

const ERROR_CONFIGS: Record<FlowError, ErrorRecoveryConfig> = {
  payment_declined:  { maxRetries: 2,  retryDelayMs: 5000,   escalateAfterAttempts: 1, userMessageTemplate: "Payment failed. Please update your payment method.", requiresUserAction: true  },
  slot_taken:        { maxRetries: 0,  retryDelayMs: 0,      escalateAfterAttempts: 0, userMessageTemplate: "This slot was just taken. Showing alternatives.",       requiresUserAction: false },
  validation_failed: { maxRetries: 0,  retryDelayMs: 0,      escalateAfterAttempts: 0, userMessageTemplate: "Please correct the highlighted fields.",                  requiresUserAction: true  },
  network_timeout:   { maxRetries: 3,  retryDelayMs: 2000,   escalateAfterAttempts: 2, userMessageTemplate: "Connection issue. Retrying automatically.",               requiresUserAction: false },
  session_expired:   { maxRetries: 0,  retryDelayMs: 0,      escalateAfterAttempts: 0, userMessageTemplate: "Session expired. Please sign in again.",                  requiresUserAction: true  },
};

function canAutoRecover(error: FlowError): boolean {
  const config = ERROR_CONFIGS[error];
  return config.maxRetries > 0 && !config.requiresUserAction;
}

function shouldRetry(error: FlowError, attemptCount: number): boolean {
  const config = ERROR_CONFIGS[error];
  return attemptCount < config.maxRetries;
}

function getErrorMessage(error: FlowError): string {
  return ERROR_CONFIGS[error].userMessageTemplate;
}

function isEscalated(error: FlowError, attemptCount: number): boolean {
  const config = ERROR_CONFIGS[error];
  return attemptCount >= config.escalateAfterAttempts && config.escalateAfterAttempts > 0;
}

function nextRetryDelayMs(error: FlowError, attemptCount: number): number {
  const config = ERROR_CONFIGS[error];
  return config.retryDelayMs * Math.pow(2, attemptCount); // exponential backoff
}

describe("Booking flow error recovery", () => {
  it("canAutoRecover: network_timeout → true (auto retry)", () => {
    expect(canAutoRecover("network_timeout")).toBe(true);
  });

  it("canAutoRecover: payment_declined → false (needs user)", () => {
    expect(canAutoRecover("payment_declined")).toBe(false);
  });

  it("canAutoRecover: slot_taken → false (no retries)", () => {
    expect(canAutoRecover("slot_taken")).toBe(false);
  });

  it("shouldRetry: network_timeout attempt 2 < max 3 → true", () => {
    expect(shouldRetry("network_timeout", 2)).toBe(true);
  });

  it("shouldRetry: network_timeout attempt 3 = max 3 → false", () => {
    expect(shouldRetry("network_timeout", 3)).toBe(false);
  });

  it("getErrorMessage: slot_taken includes alternatives message", () => {
    expect(getErrorMessage("slot_taken")).toContain("alternatives");
  });

  it("isEscalated: payment_declined after 1 attempt → true", () => {
    expect(isEscalated("payment_declined", 1)).toBe(true);
  });

  it("nextRetryDelayMs: exponential backoff", () => {
    const delay0 = nextRetryDelayMs("network_timeout", 0);
    const delay1 = nextRetryDelayMs("network_timeout", 1);
    expect(delay1).toBe(delay0 * 2);
  });
});

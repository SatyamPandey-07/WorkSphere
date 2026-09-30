/**
 * Tests for booking payment retry strategy with circuit breaker.
 */

type PaymentResultStatus = "success" | "failure" | "timeout" | "declined";

interface RetryState {
  attempts: number;
  lastAttemptAt: number | null;
  circuitOpen: boolean;
  consecutiveFailures: number;
  nextRetryAt: number | null;
}

const RETRY_DELAYS_MS = [1_000, 5_000, 15_000, 30_000, 60_000]; // exponential
const CIRCUIT_OPEN_THRESHOLD = 3; // open circuit after 3 consecutive failures
const CIRCUIT_RESET_MS = 5 * 60_000; // try to reset after 5 min

function canRetry(
  state: RetryState,
  status: PaymentResultStatus,
  nowMs: number
): boolean {
  if (status === "declined") return false; // don't retry declined cards
  if (state.circuitOpen) {
    return state.nextRetryAt !== null && nowMs >= state.nextRetryAt;
  }
  return state.attempts < RETRY_DELAYS_MS.length;
}

function nextRetryDelay(attempts: number): number {
  return RETRY_DELAYS_MS[Math.min(attempts, RETRY_DELAYS_MS.length - 1)];
}

function recordAttempt(
  state: RetryState,
  status: PaymentResultStatus,
  nowMs: number
): RetryState {
  const isFailure = status !== "success";
  const newConsecutive = isFailure ? state.consecutiveFailures + 1 : 0;
  const shouldOpenCircuit = newConsecutive >= CIRCUIT_OPEN_THRESHOLD;
  return {
    attempts: state.attempts + 1,
    lastAttemptAt: nowMs,
    circuitOpen: shouldOpenCircuit,
    consecutiveFailures: newConsecutive,
    nextRetryAt: isFailure
      ? nowMs + (shouldOpenCircuit ? CIRCUIT_RESET_MS : nextRetryDelay(state.attempts + 1))
      : null,
  };
}

const INITIAL_STATE: RetryState = {
  attempts: 0, lastAttemptAt: null, circuitOpen: false,
  consecutiveFailures: 0, nextRetryAt: null,
};
const NOW = 1_700_000_000_000;

describe("Payment retry strategy", () => {
  it("canRetry: initial state + timeout → true", () => {
    expect(canRetry(INITIAL_STATE, "timeout", NOW)).toBe(true);
  });

  it("canRetry: declined → false (never retry)", () => {
    expect(canRetry(INITIAL_STATE, "declined", NOW)).toBe(false);
  });

  it("canRetry: max attempts reached → false", () => {
    const maxed = { ...INITIAL_STATE, attempts: 5 };
    expect(canRetry(maxed, "timeout", NOW)).toBe(false);
  });

  it("recordAttempt: failure increments consecutive", () => {
    const updated = recordAttempt(INITIAL_STATE, "failure", NOW);
    expect(updated.consecutiveFailures).toBe(1);
    expect(updated.circuitOpen).toBe(false);
  });

  it("recordAttempt: 3 consecutive opens circuit", () => {
    let state = INITIAL_STATE;
    state = recordAttempt(state, "failure", NOW);
    state = recordAttempt(state, "failure", NOW);
    state = recordAttempt(state, "failure", NOW);
    expect(state.circuitOpen).toBe(true);
  });

  it("recordAttempt: success resets consecutive failures", () => {
    const failed = { ...INITIAL_STATE, consecutiveFailures: 2 };
    const updated = recordAttempt(failed, "success", NOW);
    expect(updated.consecutiveFailures).toBe(0);
  });

  it("canRetry: open circuit before reset → false", () => {
    const open = { ...INITIAL_STATE, circuitOpen: true, nextRetryAt: NOW + 60_000 };
    expect(canRetry(open, "timeout", NOW)).toBe(false);
  });

  it("canRetry: open circuit after reset time → true", () => {
    const open = { ...INITIAL_STATE, circuitOpen: true, nextRetryAt: NOW - 1 };
    expect(canRetry(open, "timeout", NOW)).toBe(true);
  });
});

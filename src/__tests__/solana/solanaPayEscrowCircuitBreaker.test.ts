import {
  SolanaPayEscrowManager,
  isHttp429Error,
  type ReserveSeatOptions,
  type CircuitBreakerConfig,
} from "@/lib/solana/solanaPayEscrow";
import type { Connection, SignatureStatus } from "@solana/web3.js";

describe("SolanaPayEscrow Circuit Breaker & Failover", () => {
  let manager: SolanaPayEscrowManager;
  let primaryConnection: jest.Mocked<Connection>;
  let fallbackConnection: jest.Mocked<Connection>;

  beforeEach(() => {
    jest.useFakeTimers();
    manager = new SolanaPayEscrowManager();

    primaryConnection = {
      getSignatureStatuses: jest.fn(),
      onSignatureWithOptions: jest.fn(),
      removeSignatureListener: jest.fn(),
    } as unknown as jest.Mocked<Connection>;

    fallbackConnection = {
      getSignatureStatuses: jest.fn(),
      onSignatureWithOptions: jest.fn(),
      removeSignatureListener: jest.fn(),
    } as unknown as jest.Mocked<Connection>;
  });

  afterEach(() => {
    manager.reset();
    jest.useRealTimers();
  });

  it("identifies HTTP 429 rate limit errors accurately", () => {
    expect(isHttp429Error(new Error("HTTP 429: Too Many Requests"))).toBe(true);
    expect(isHttp429Error({ status: 429 })).toBe(true);
    expect(isHttp429Error({ code: 429 })).toBe(true);
    expect(isHttp429Error({ response: { status: 429 } })).toBe(true);
    expect(isHttp429Error(new Error("Rate limit exceeded"))).toBe(true);
    expect(isHttp429Error(new Error("Generic Network Error"))).toBe(false);
  });

  it("1. tracks consecutive HTTP 429 responses and 2. automatically rotates to secondary RPC endpoint", async () => {
    let callCount = 0;
    const pollFn = jest.fn(async (_sig: string, conn: Connection) => {
      callCount++;
      if (conn === primaryConnection) {
        const err = new Error("RPC Rate Limit Reached (429)");
        (err as any).status = 429;
        throw err;
      }
      return {
        slot: 100,
        confirmations: 10,
        err: null,
        confirmationStatus: "confirmed",
      } as SignatureStatus;
    });

    const circuitCallback = jest.fn();

    await manager.reserveSeatOptimistically({
      connection: primaryConnection,
      seatId: "seat-1",
      venueId: "venue-1",
      signature: "sig-test-429",
      payerWallet: "wallet-test",
      amount: 1.5,
      confirmationMode: "polling",
      pollIntervalMs: 100,
      pollSignatureStatus: pollFn,
      circuitBreaker: {
        consecutive429Threshold: 3,
        cooldownMs: 5000,
        fallbackConnection,
      },
      callbacks: {
        onCircuitStateChange: circuitCallback,
      },
    });

    const sub = manager.getActiveSubscription("seat-1");
    expect(sub).toBeDefined();
    expect(sub?.circuitState).toBe("closed");
    expect(sub?.consecutive429Count).toBe(0);

    // 1st tick: 429
    await jest.advanceTimersByTimeAsync(100);
    expect(sub?.consecutive429Count).toBe(1);
    expect(sub?.circuitState).toBe("closed");

    // 2nd tick: 429
    await jest.advanceTimersByTimeAsync(100);
    expect(sub?.consecutive429Count).toBe(2);
    expect(sub?.circuitState).toBe("closed");

    // 3rd tick: 429 -> reaches threshold 3, rotates to fallback
    await jest.advanceTimersByTimeAsync(100);
    expect(sub?.consecutive429Count).toBe(3);
    expect(sub?.circuitState).toBe("open");
    expect(sub?.activeEndpoint).toBe("fallback");
    expect(circuitCallback).toHaveBeenCalledWith("open", "fallback");

    // 4th tick: Now querying fallback
    await jest.advanceTimersByTimeAsync(100);
    expect(pollFn).toHaveBeenLastCalledWith("sig-test-429", fallbackConnection);
    expect(sub?.activeEndpoint).toBe("fallback");
  });

  it("3. continues active escrow polling and preserves subscription state during failover", async () => {
    const onStateChange = jest.fn();
    const onConfirmed = jest.fn();

    const pollFn = jest.fn(async (_sig: string, conn: Connection) => {
      if (conn === primaryConnection) {
        const err = new Error("429 Too Many Requests");
        (err as any).statusCode = 429;
        throw err;
      }
      return {
        slot: 120,
        confirmations: 20,
        err: null,
        confirmationStatus: "confirmed",
      } as SignatureStatus;
    });

    await manager.reserveSeatOptimistically({
      connection: primaryConnection,
      seatId: "seat-continuous",
      venueId: "venue-1",
      signature: "sig-continuous",
      payerWallet: "wallet-continuous",
      amount: 2.0,
      confirmationMode: "polling",
      pollIntervalMs: 100,
      pollSignatureStatus: pollFn,
      circuitBreaker: {
        consecutive429Threshold: 2,
        cooldownMs: 5000,
        fallbackConnection,
      },
      callbacks: {
        onStateChange,
        onConfirmed,
      },
    });

    // Advance through 2 consecutive 429s
    await jest.advanceTimersByTimeAsync(200);

    const sub = manager.getActiveSubscription("seat-continuous");
    expect(sub?.circuitState).toBe("open");
    expect(sub?.signature).toBe("sig-continuous");

    // Next tick polls fallback and progresses state to confirmed without interruption
    await jest.advanceTimersByTimeAsync(100);

    const state = manager.getSeatState("seat-continuous");
    expect(state?.state).toBe("confirmed");
    expect(state?.slot).toBe(120);
    expect(onConfirmed).toHaveBeenCalled();
  });

  it("4. restores primary RPC endpoint after cool-down when it becomes healthy", async () => {
    let primaryHealthy = false;

    const pollFn = jest.fn(async (_sig: string, conn: Connection) => {
      if (conn === primaryConnection) {
        if (!primaryHealthy) {
          const err = new Error("429 rate limit");
          (err as any).status = 429;
          throw err;
        }
        return {
          slot: 200,
          confirmations: 32,
          err: null,
          confirmationStatus: "finalized",
        } as SignatureStatus;
      }
      return {
        slot: 150,
        confirmations: 15,
        err: null,
        confirmationStatus: "confirmed",
      } as SignatureStatus;
    });

    const circuitCallback = jest.fn();

    await manager.reserveSeatOptimistically({
      connection: primaryConnection,
      seatId: "seat-recovery",
      venueId: "venue-1",
      signature: "sig-recovery",
      payerWallet: "wallet-recovery",
      amount: 1.0,
      confirmationMode: "polling",
      pollIntervalMs: 100,
      pollSignatureStatus: pollFn,
      circuitBreaker: {
        consecutive429Threshold: 1,
        cooldownMs: 2000,
        fallbackConnection,
      },
      callbacks: {
        onCircuitStateChange: circuitCallback,
      },
    });

    // Tick 1: Primary fails with 429 -> Circuit opens immediately
    await jest.advanceTimersByTimeAsync(100);
    const sub = manager.getActiveSubscription("seat-recovery");
    expect(sub?.circuitState).toBe("open");
    expect(sub?.activeEndpoint).toBe("fallback");

    // Tick 2: Fallback polled (returns confirmed)
    await jest.advanceTimersByTimeAsync(100);
    expect(pollFn).toHaveBeenLastCalledWith("sig-recovery", fallbackConnection);

    // Primary becomes healthy again, cool-down passes (2000ms)
    primaryHealthy = true;
    await jest.advanceTimersByTimeAsync(2000);

    // Controlled test tick in half_open -> primary succeeds -> closes circuit
    expect(pollFn).toHaveBeenLastCalledWith("sig-recovery", primaryConnection);
    expect(circuitCallback).toHaveBeenCalledWith("closed", "primary");
    expect(sub?.circuitState).toBe("closed");
    expect(sub?.activeEndpoint).toBe("primary");
  });

  it("5. handles repeated 429 responses during recovery without rapid loops", async () => {
    const pollFn = jest.fn(async (_sig: string, conn: Connection) => {
      if (conn === primaryConnection) {
        const err = new Error("Still 429 Too Many Requests");
        (err as any).status = 429;
        throw err;
      }
      return {
        slot: 210,
        confirmations: 10,
        err: null,
        confirmationStatus: "confirmed",
      } as SignatureStatus;
    });

    const circuitCallback = jest.fn();

    await manager.reserveSeatOptimistically({
      connection: primaryConnection,
      seatId: "seat-repeated-429",
      venueId: "venue-1",
      signature: "sig-repeated",
      payerWallet: "wallet-repeated",
      amount: 1.0,
      confirmationMode: "polling",
      pollIntervalMs: 100,
      pollSignatureStatus: pollFn,
      circuitBreaker: {
        consecutive429Threshold: 1,
        cooldownMs: 1000,
        fallbackConnection,
      },
      callbacks: {
        onCircuitStateChange: circuitCallback,
      },
    });

    // Trip circuit to open
    await jest.advanceTimersByTimeAsync(100);
    const sub = manager.getActiveSubscription("seat-repeated-429");
    expect(sub?.circuitState).toBe("open");

    // Cool-down elapses -> enters half_open
    await jest.advanceTimersByTimeAsync(1000);

    // Primary fails again with 429 -> immediately trips back to open and returns to fallback
    expect(sub?.circuitState).toBe("open");
    expect(sub?.activeEndpoint).toBe("fallback");
    expect(circuitCallback).toHaveBeenCalledWith("open", "fallback");
  });

  it("6. resets consecutive 429 counter when an RPC request succeeds", async () => {
    let callCount = 0;
    const pollFn = jest.fn(async () => {
      callCount++;
      if (callCount === 1 || callCount === 2) {
        const err = new Error("429 rate limit");
        (err as any).status = 429;
        throw err;
      }
      // 3rd call succeeds before reaching threshold 3
      return {
        slot: 100,
        confirmations: 5,
        err: null,
        confirmationStatus: "confirmed",
      } as SignatureStatus;
    });

    await manager.reserveSeatOptimistically({
      connection: primaryConnection,
      seatId: "seat-reset-counter",
      venueId: "venue-1",
      signature: "sig-reset",
      payerWallet: "wallet-reset",
      amount: 1.0,
      confirmationMode: "polling",
      pollIntervalMs: 100,
      pollSignatureStatus: pollFn,
      circuitBreaker: {
        consecutive429Threshold: 3,
        fallbackConnection,
      },
    });

    const sub = manager.getActiveSubscription("seat-reset-counter");

    // 2 failed calls
    await jest.advanceTimersByTimeAsync(200);
    expect(sub?.consecutive429Count).toBe(2);
    expect(sub?.circuitState).toBe("closed");

    // 3rd call succeeds -> resets counter to 0
    await jest.advanceTimersByTimeAsync(100);
    expect(sub?.consecutive429Count).toBe(0);
    expect(sub?.circuitState).toBe("closed");
  });

  it("7. handles missing fallback RPC configuration safely", async () => {
    const pollFn = jest.fn(async () => {
      const err = new Error("429 Too Many Requests");
      (err as any).status = 429;
      throw err;
    });

    await manager.reserveSeatOptimistically({
      connection: primaryConnection,
      seatId: "seat-no-fallback",
      venueId: "venue-1",
      signature: "sig-no-fallback",
      payerWallet: "wallet-no-fallback",
      amount: 1.0,
      confirmationMode: "polling",
      pollIntervalMs: 100,
      pollSignatureStatus: pollFn,
      circuitBreaker: {
        consecutive429Threshold: 2,
        // fallbackConnection omitted intentionally
      },
    });

    const sub = manager.getActiveSubscription("seat-no-fallback");

    // Advance through 429s -> trips circuit
    await jest.advanceTimersByTimeAsync(200);
    expect(sub?.circuitState).toBe("open");
    // Without fallback, query stays on primary safely without throwing unhandled exceptions
    expect(sub?.activeConnection).toBe(primaryConnection);
  });
});

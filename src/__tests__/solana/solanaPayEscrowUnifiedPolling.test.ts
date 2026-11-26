import {
  SolanaPayEscrowManager,
  isHttp429Error,
  type ReserveSeatOptions,
  type ActiveSubscription,
} from "@/lib/solana/solanaPayEscrow";
import type { Connection, SignatureStatus } from "@solana/web3.js";

describe("SolanaPayEscrow ActiveSubscription & Polling Consolidation", () => {
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

  it("properly initializes timeoutEndMs, activeConnectionIsFallback, and rpc429ConsecutiveCount on ActiveSubscription", async () => {
    const startTime = 1_000_000;
    jest.setSystemTime(startTime);

    await manager.reserveSeatOptimistically({
      connection: primaryConnection,
      seatId: "seat-init-check",
      venueId: "venue-check",
      signature: "sig-check",
      payerWallet: "wallet-check",
      amount: 1.0,
      timeoutMs: 30_000,
      confirmationMode: "polling",
      circuitBreaker: {
        fallbackConnection,
      },
    });

    const sub = manager.getActiveSubscription("seat-init-check");
    expect(sub).toBeDefined();
    expect(sub?.timeoutEndMs).toBe(startTime + 30_000);
    expect(sub?.activeConnectionIsFallback).toBe(false);
    expect(sub?.consecutive429Count).toBe(0);
    expect(sub?.rpc429ConsecutiveCount).toBe(0);
    expect(sub?.activeEndpoint).toBe("primary");
  });

  it("updates activeConnectionIsFallback and rpc429ConsecutiveCount when 429 threshold is hit", async () => {
    const pollFn = jest.fn(async () => {
      const err = new Error("429 rate limit exceeded");
      (err as any).status = 429;
      throw err;
    });

    await manager.reserveSeatOptimistically({
      connection: primaryConnection,
      seatId: "seat-failover-check",
      venueId: "venue-check",
      signature: "sig-failover",
      payerWallet: "wallet-check",
      amount: 1.0,
      confirmationMode: "polling",
      pollIntervalMs: 100,
      pollSignatureStatus: pollFn,
      circuitBreaker: {
        consecutive429Threshold: 2,
        fallbackConnection,
      },
    });

    const sub = manager.getActiveSubscription("seat-failover-check");

    // Advance first 429
    await jest.advanceTimersByTimeAsync(100);
    expect(sub?.consecutive429Count).toBe(1);
    expect(sub?.rpc429ConsecutiveCount).toBe(1);
    expect(sub?.activeConnectionIsFallback).toBe(false);

    // Advance second 429 -> circuit opens, rotates to fallback
    await jest.advanceTimersByTimeAsync(100);
    expect(sub?.consecutive429Count).toBe(2);
    expect(sub?.rpc429ConsecutiveCount).toBe(2);
    expect(sub?.activeConnectionIsFallback).toBe(true);
    expect(sub?.activeEndpoint).toBe("fallback");
  });

  it("uses consistent timeoutEndMs without drift to trigger timeout rollback", async () => {
    const startTime = 500_000;
    jest.setSystemTime(startTime);

    const onRollback = jest.fn();

    await manager.reserveSeatOptimistically({
      connection: primaryConnection,
      seatId: "seat-timeout-drift",
      venueId: "venue-timeout",
      signature: "sig-timeout",
      payerWallet: "wallet-timeout",
      amount: 1.0,
      timeoutMs: 10_000,
      confirmationMode: "polling",
      pollIntervalMs: 2_000,
      pollSignatureStatus: jest.fn(async () => null), // Never confirmed
      callbacks: {
        onRollback,
      },
    });

    const sub = manager.getActiveSubscription("seat-timeout-drift");
    expect(sub?.timeoutEndMs).toBe(startTime + 10_000);

    // Advance 8 seconds - still pending
    await jest.advanceTimersByTimeAsync(8_000);
    expect(manager.getSeatState("seat-timeout-drift")?.state).toBe("provisionally_reserved");

    // Advance past 10 seconds - timeout rolls back
    await jest.advanceTimersByTimeAsync(2_500);
    expect(manager.getSeatState("seat-timeout-drift")?.state).toBe("available");
    expect(manager.getSeatState("seat-timeout-drift")?.paymentStatus).toBe("timeout");
  });

  it("resets rpc429ConsecutiveCount on successful signature status poll", async () => {
    let attempts = 0;
    const pollFn = jest.fn(async () => {
      attempts++;
      if (attempts === 1) {
        const err = new Error("429 rate limit");
        (err as any).status = 429;
        throw err;
      }
      return {
        slot: 100,
        confirmations: 5,
        err: null,
        confirmationStatus: "confirmed",
      } as SignatureStatus;
    });

    await manager.reserveSeatOptimistically({
      connection: primaryConnection,
      seatId: "seat-reset-check",
      venueId: "venue-check",
      signature: "sig-reset-check",
      payerWallet: "wallet-check",
      amount: 1.0,
      confirmationMode: "polling",
      pollIntervalMs: 100,
      pollSignatureStatus: pollFn,
      circuitBreaker: {
        consecutive429Threshold: 3,
        fallbackConnection,
      },
    });

    const sub = manager.getActiveSubscription("seat-reset-check");

    // 1st tick: 429
    await jest.advanceTimersByTimeAsync(100);
    expect(sub?.consecutive429Count).toBe(1);
    expect(sub?.rpc429ConsecutiveCount).toBe(1);

    // 2nd tick: Success -> resets counter
    await jest.advanceTimersByTimeAsync(100);
    expect(sub?.consecutive429Count).toBe(0);
    expect(sub?.rpc429ConsecutiveCount).toBe(0);
  });
});

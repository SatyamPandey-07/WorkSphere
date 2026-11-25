/**
 * solanaPayEscrow.test.ts
 *
 * Unit tests asserting 5-second abort timeout on Solana escrow transaction status polling,
 * secondary fallback RPC failover, and AbortSignal handling (#9448).
 */

import {
  solanaPayEscrowManager,
  reserveSeatOptimistically,
  fetchSignatureStatusWithTimeout,
  resetSeatReservations,
  cleanupSeatReservation,
  DEFAULT_RPC_POLL_TIMEOUT_MS,
  STATUS_TIMEOUT,
  SolanaRpcPollTimeoutError,
} from "@/lib/solana/solanaPayEscrow";
import type { Connection, SignatureStatus } from "@solana/web3.js";

const SIGNATURE = "5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYj7WQ35MQR52vMm6vKEG7G5gF24yuvWiJJ43WDN3yvUJklSzLj699";

function makeSignatureStatus(
  confirmationStatus: "confirmed" | "finalized" | "processed" = "confirmed",
  slot = 5000,
): SignatureStatus {
  return {
    slot,
    confirmations: confirmationStatus === "finalized" ? null : 32,
    status: "Confirmed",
    err: null,
    confirmationStatus,
  } as SignatureStatus;
}

describe("Solana Escrow 5-Second Abort Timeout & Fallback Failover (#9448)", () => {
  let mockConnection: Partial<Connection>;
  let mockFallbackConnection: Partial<Connection>;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    resetSeatReservations();

    mockConnection = {
      onSignatureWithOptions: jest.fn(),
      removeSignatureListener: jest.fn().mockResolvedValue(undefined),
      getSignatureStatuses: jest.fn().mockResolvedValue({ value: [null] }),
    };

    mockFallbackConnection = {
      onSignatureWithOptions: jest.fn(),
      removeSignatureListener: jest.fn().mockResolvedValue(undefined),
      getSignatureStatuses: jest.fn().mockResolvedValue({ value: [null] }),
    };
  });

  afterEach(() => {
    jest.useRealTimers();
    resetSeatReservations();
  });

  describe("5-Second Strict Abort Timeout", () => {
    it("aborts a hanging primary RPC poll after 5 seconds without hanging indefinitely", async () => {
      // Primary RPC hangs indefinitely (unresolved promise)
      const hangingPoll = jest.fn((sig: string, opts?: { signal?: AbortSignal }) => {
        return new Promise<SignatureStatus | null>((resolve, reject) => {
          opts?.signal?.addEventListener("abort", () => {
            reject(new Error("Aborted by timeout controller"));
          });
        });
      });

      const onRollback = jest.fn();
      const onError = jest.fn();

      await reserveSeatOptimistically({
        connection: mockConnection as Connection,
        seatId: "seat-hang-1",
        venueId: "venue-sf",
        signature: SIGNATURE,
        payerWallet: "7Y5...payer",
        amount: 1.0,
        confirmationMode: "polling",
        pollIntervalMs: 100,
        pollSignatureStatus: hangingPoll,
        callbacks: { onRollback, onError },
      });

      // Initially provisionally reserved
      expect(solanaPayEscrowManager.getSeatState("seat-hang-1")?.state).toBe("provisionally_reserved");

      // Advance by pollIntervalMs to kick off first poll
      await jest.advanceTimersByTimeAsync(100);
      expect(hangingPoll).toHaveBeenCalled();

      // Advance time by the 5000ms poll timeout limit
      await jest.advanceTimersByTimeAsync(DEFAULT_RPC_POLL_TIMEOUT_MS + 200);

      // Verify that the poll aborted cleanly and rolled back with STATUS_TIMEOUT
      const state = solanaPayEscrowManager.getSeatState("seat-hang-1");
      expect(state?.state).toBe("available");
      expect(state?.paymentStatus).toBe(STATUS_TIMEOUT);
      expect(state?.error).toContain("timed out after 5000ms");
      expect(onRollback).toHaveBeenCalledWith(
        expect.stringContaining("timed out after 5000ms"),
        expect.objectContaining({ state: "available", paymentStatus: STATUS_TIMEOUT }),
      );
    });

    it("fetchSignatureStatusWithTimeout wraps RPC call and aborts with STATUS_TIMEOUT after 5000ms", async () => {
      const hangingConnection = {
        getSignatureStatuses: jest.fn().mockImplementation(() => {
          return new Promise(() => {
            // never resolves
          });
        }),
      } as unknown as Connection;

      const pollPromise = fetchSignatureStatusWithTimeout(hangingConnection, SIGNATURE);

      await jest.advanceTimersByTimeAsync(DEFAULT_RPC_POLL_TIMEOUT_MS + 50);

      const result = await pollPromise;
      expect(result).toBe(STATUS_TIMEOUT);
    });
  });

  describe("Fallback RPC Failover on Primary Timeout", () => {
    it("attempts fallback RPC when primary times out and confirms reservation", async () => {
      let primarySignalReceived = false;

      // Primary poll hangs until aborted by the 5000ms timer
      const primaryPoll = jest.fn((sig: string, opts?: { signal?: AbortSignal }) => {
        return new Promise<SignatureStatus | null>((_, reject) => {
          opts?.signal?.addEventListener("abort", () => {
            primarySignalReceived = true;
            reject(new Error("Primary poll aborted"));
          });
        });
      });

      // Secondary fallback RPC succeeds with confirmed status
      const fallbackPoll = jest.fn().mockResolvedValue(makeSignatureStatus("confirmed", 8888));
      const onConfirmed = jest.fn();

      await reserveSeatOptimistically({
        connection: mockConnection as Connection,
        seatId: "seat-failover-1",
        venueId: "venue-sf",
        signature: SIGNATURE,
        payerWallet: "7Y5...payer",
        amount: 1.0,
        confirmationMode: "polling",
        pollIntervalMs: 200,
        pollSignatureStatus: primaryPoll,
        fallbackPollSignatureStatus: fallbackPoll,
        callbacks: { onConfirmed },
      });

      // Kick off first poll
      await jest.advanceTimersByTimeAsync(200);
      expect(primaryPoll).toHaveBeenCalled();
      expect(fallbackPoll).not.toHaveBeenCalled();

      // Advance through the 5000ms primary timeout
      await jest.advanceTimersByTimeAsync(DEFAULT_RPC_POLL_TIMEOUT_MS + 100);

      // Primary was aborted, and fallback was attempted
      expect(primarySignalReceived).toBe(true);
      expect(fallbackPoll).toHaveBeenCalledWith(
        SIGNATURE,
        expect.objectContaining({ signal: expect.any(Object) }),
      );

      // Reservation transitioned to confirmed via the fallback RPC
      const state = solanaPayEscrowManager.getSeatState("seat-failover-1");
      expect(state?.state).toBe("confirmed");
      expect(state?.paymentStatus).toBe("confirmed");
      expect(state?.slot).toBe(8888);
      expect(onConfirmed).toHaveBeenCalledWith(
        expect.objectContaining({ state: "confirmed", slot: 8888 }),
      );
    });

    it("fails over using fallbackConnection getSignatureStatuses when primary times out", async () => {
      const primaryConnection = {
        getSignatureStatuses: jest.fn().mockImplementation(() => new Promise(() => {})),
      } as unknown as Connection;

      const fallbackConnection = {
        getSignatureStatuses: jest.fn().mockResolvedValue({
          value: [makeSignatureStatus("finalized", 9999)],
        }),
      } as unknown as Connection;

      const onFinalized = jest.fn();

      await reserveSeatOptimistically({
        connection: primaryConnection,
        fallbackConnection,
        seatId: "seat-failover-conn",
        venueId: "venue-sf",
        signature: SIGNATURE,
        payerWallet: "7Y5...payer",
        amount: 1.0,
        confirmationMode: "polling",
        pollIntervalMs: 100,
        callbacks: { onFinalized },
      });

      // Kick off first poll and advance through 5000ms timeout
      await jest.advanceTimersByTimeAsync(100 + DEFAULT_RPC_POLL_TIMEOUT_MS + 100);

      expect(fallbackConnection.getSignatureStatuses).toHaveBeenCalledWith(
        [SIGNATURE],
        expect.anything(),
      );

      const state = solanaPayEscrowManager.getSeatState("seat-failover-conn");
      expect(state?.state).toBe("finalized");
      expect(onFinalized).toHaveBeenCalled();
    });

    it("returns STATUS_TIMEOUT when both primary and fallback RPC time out", async () => {
      const primaryConnection = {
        getSignatureStatuses: jest.fn().mockImplementation(() => new Promise(() => {})),
      } as unknown as Connection;

      const fallbackPoll = jest.fn(() => new Promise<SignatureStatus | null>(() => {}));

      const resultPromise = fetchSignatureStatusWithTimeout(primaryConnection, SIGNATURE, {
        fallbackPollSignatureStatus: fallbackPoll,
      });

      // Primary times out after 5000ms -> fallback attempted
      await jest.advanceTimersByTimeAsync(DEFAULT_RPC_POLL_TIMEOUT_MS + 50);
      expect(fallbackPoll).toHaveBeenCalled();

      // Fallback times out after another 5000ms
      await jest.advanceTimersByTimeAsync(DEFAULT_RPC_POLL_TIMEOUT_MS + 50);

      const result = await resultPromise;
      expect(result).toBe(STATUS_TIMEOUT);
    });
  });

  describe("AbortSignal and Component Unmount Handling", () => {
    it("aborts active polling immediately when client AbortSignal triggers", async () => {
      const abortController = new AbortController();
      let pollAborted = false;

      const pollFn = jest.fn((sig: string, opts?: { signal?: AbortSignal }) => {
        opts?.signal?.addEventListener("abort", () => {
          pollAborted = true;
        });
        return new Promise<SignatureStatus | null>(() => {});
      });

      const onRollback = jest.fn();

      await reserveSeatOptimistically({
        connection: mockConnection as Connection,
        seatId: "seat-abort-client",
        venueId: "venue-sf",
        signature: SIGNATURE,
        payerWallet: "7Y5...payer",
        amount: 1.0,
        confirmationMode: "polling",
        pollIntervalMs: 100,
        signal: abortController.signal,
        pollSignatureStatus: pollFn,
        callbacks: { onRollback },
      });

      expect(solanaPayEscrowManager.getSeatState("seat-abort-client")?.state).toBe("provisionally_reserved");

      // Advance to start the poll
      await jest.advanceTimersByTimeAsync(100);
      expect(pollFn).toHaveBeenCalled();

      // Trigger client abortion
      abortController.abort();

      expect(pollAborted).toBe(true);
      const state = solanaPayEscrowManager.getSeatState("seat-abort-client");
      expect(state?.state).toBe("available");
      expect(state?.error).toContain("Reservation aborted by client");
    });

    it("cleans up active timers and polling subscriptions via cleanupSeatReservation", async () => {
      const pollFn = jest.fn().mockResolvedValue(null);

      await reserveSeatOptimistically({
        connection: mockConnection as Connection,
        seatId: "seat-unmount-clean",
        venueId: "venue-sf",
        signature: SIGNATURE,
        payerWallet: "7Y5...payer",
        amount: 1.0,
        confirmationMode: "polling",
        pollIntervalMs: 500,
        pollSignatureStatus: pollFn,
      });

      // Kick off first poll
      await jest.advanceTimersByTimeAsync(500);
      expect(pollFn).toHaveBeenCalledTimes(1);

      // Simulate component unmount cleanup
      cleanupSeatReservation("seat-unmount-clean");

      // Advance timers — no more polls should execute
      await jest.advanceTimersByTimeAsync(3000);
      expect(pollFn).toHaveBeenCalledTimes(1);
    });
  });
});

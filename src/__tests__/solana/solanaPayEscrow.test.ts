/**
 * Tests for optimistic UI updates and WebSocket confirmation listener for Solana Pay seat bookings (#7169).
 */

import {
  reserveSeatOptimistically,
  rollbackSeatReservation,
  getSeatReservationState,
  resetSeatReservations,
  calculatePriorityFeeForAttempt,
  isBlockhashExpiredError,
  verifyBlockheightExpiration,
  fetchLatestBlockhashWithBackoff,
  type ReserveSeatOptions,
} from "@/lib/solana/solanaPayEscrow";
import {
  ProofOfWorkValidator,
  type PoWSubmission,
} from "@/core/ledger/ProofOfWorkValidator";
import type { Connection } from "@solana/web3.js";

describe("SolanaPayEscrow: Optimistic UI & WebSocket Confirmation (#7169)", () => {
  let mockConnection: Partial<Connection>;
  let signatureCallbacks: Map<
    number,
    {
      signature: string;
      callback: (result: { err: any }, context: { slot: number }) => void;
      commitment: string;
    }
  >;
  let subCounter = 1;
  const mockRemoveSignatureListener = jest.fn();

  beforeEach(() => {
    resetSeatReservations();
    jest.clearAllMocks();
    jest.useFakeTimers();

    signatureCallbacks = new Map();
    subCounter = 1;

    mockConnection = {
      onSignatureWithOptions: jest
        .fn()
        .mockImplementation(
          (
            signature: string,
            callback: any,
            options: { commitment: string },
          ) => {
            const id = subCounter++;
            signatureCallbacks.set(id, {
              signature,
              callback,
              commitment: options?.commitment ?? "confirmed",
            });
            return id;
          },
        ),
      removeSignatureListener:
        mockRemoveSignatureListener.mockResolvedValue(undefined),
    };
  });

  afterEach(() => {
    jest.useRealTimers();
    resetSeatReservations();
  });

  function triggerSignatureNotification(
    commitment: "confirmed" | "finalized",
    err: any = null,
    slot = 12345,
  ) {
    for (const [, item] of signatureCallbacks) {
      if (item.commitment === commitment) {
        item.callback({ err }, { slot });
      }
    }
  }

  describe("Optimistic UI state transition", () => {
    it("transitions seat state to provisionally_reserved immediately upon call", async () => {
      const onStateChange = jest.fn();
      const onProvisionallyReserved = jest.fn();

      const options: ReserveSeatOptions = {
        connection: mockConnection as Connection,
        seatId: "seat-101",
        venueId: "venue-sf-1",
        signature: "sig_abc123",
        payerWallet: "7Y5...payer",
        amount: 0.5,
        currency: "SOL",
        callbacks: {
          onStateChange,
          onProvisionallyReserved,
        },
      };

      const result = await reserveSeatOptimistically(options);

      // Instantaneous optimistic update
      expect(result.state).toBe("provisionally_reserved");
      expect(result.paymentStatus).toBe("pending");
      expect(result.seatId).toBe("seat-101");
      expect(result.signature).toBe("sig_abc123");

      expect(onStateChange).toHaveBeenCalledWith(
        expect.objectContaining({
          state: "provisionally_reserved",
          paymentStatus: "pending",
        }),
      );
      expect(onProvisionallyReserved).toHaveBeenCalledWith(
        expect.objectContaining({
          state: "provisionally_reserved",
        }),
      );

      // Inspect persisted state in registry
      const stored = getSeatReservationState("seat-101");
      expect(stored?.state).toBe("provisionally_reserved");
      expect(stored?.paymentStatus).toBe("pending");
    });

    it("throws when required parameters are missing", async () => {
      await expect(
        reserveSeatOptimistically({
          connection: mockConnection as Connection,
          seatId: "",
          venueId: "venue-1",
          signature: "sig-1",
          payerWallet: "wallet-1",
          amount: 1,
        }),
      ).rejects.toThrow("seatId is required");

      await expect(
        reserveSeatOptimistically({
          connection: mockConnection as Connection,
          seatId: "seat-1",
          venueId: "",
          signature: "sig-1",
          payerWallet: "wallet-1",
          amount: 1,
        }),
      ).rejects.toThrow("venueId is required");

      await expect(
        reserveSeatOptimistically({
          connection: mockConnection as Connection,
          seatId: "seat-1",
          venueId: "venue-1",
          signature: "",
          payerWallet: "wallet-1",
          amount: 1,
        }),
      ).rejects.toThrow("Transaction signature is required");

      await expect(
        reserveSeatOptimistically({
          connection: mockConnection as Connection,
          seatId: "seat-1",
          venueId: "venue-1",
          signature: "sig-1",
          payerWallet: "",
          amount: 1,
        }),
      ).rejects.toThrow("payerWallet address is required");
    });

    it("rejects attempt to reserve a seat that is already provisionally reserved or confirmed by another wallet", async () => {
      await reserveSeatOptimistically({
        connection: mockConnection as Connection,
        seatId: "seat-duplicate",
        venueId: "venue-1",
        signature: "sig_first",
        payerWallet: "wallet-1",
        amount: 1,
      });

      await expect(
        reserveSeatOptimistically({
          connection: mockConnection as Connection,
          seatId: "seat-duplicate",
          venueId: "venue-1",
          signature: "sig_second",
          payerWallet: "wallet-2",
          amount: 1,
        }),
      ).rejects.toThrow("already provisionally_reserved");
    });
  });

  describe("WebSocket subscription & confirmation lifecycle", () => {
    it("subscribes to onSignatureWithOptions for confirmed and finalized commitments", async () => {
      await reserveSeatOptimistically({
        connection: mockConnection as Connection,
        seatId: "seat-ws",
        venueId: "venue-1",
        signature: "sig_ws_123",
        payerWallet: "wallet-1",
        amount: 1,
      });

      expect(mockConnection.onSignatureWithOptions).toHaveBeenCalledTimes(2);
      expect(mockConnection.onSignatureWithOptions).toHaveBeenCalledWith(
        "sig_ws_123",
        expect.any(Function),
        { commitment: "confirmed" },
      );
      expect(mockConnection.onSignatureWithOptions).toHaveBeenCalledWith(
        "sig_ws_123",
        expect.any(Function),
        { commitment: "finalized" },
      );
    });

    it("transitions smoothly from pending -> confirmed -> finalized", async () => {
      const onStateChange = jest.fn();
      const onConfirmed = jest.fn();
      const onFinalized = jest.fn();

      await reserveSeatOptimistically({
        connection: mockConnection as Connection,
        seatId: "seat-lifecycle",
        venueId: "venue-1",
        signature: "sig_lifecycle",
        payerWallet: "wallet-1",
        amount: 2,
        callbacks: {
          onStateChange,
          onConfirmed,
          onFinalized,
        },
      });

      // 1. Trigger confirmed notification
      triggerSignatureNotification("confirmed", null, 500);

      let current = getSeatReservationState("seat-lifecycle");
      expect(current?.state).toBe("confirmed");
      expect(current?.paymentStatus).toBe("confirmed");
      expect(current?.slot).toBe(500);
      expect(onConfirmed).toHaveBeenCalledWith(
        expect.objectContaining({ state: "confirmed", slot: 500 }),
      );

      // 2. Trigger finalized notification
      triggerSignatureNotification("finalized", null, 532);

      current = getSeatReservationState("seat-lifecycle");
      expect(current?.state).toBe("finalized");
      expect(current?.paymentStatus).toBe("finalized");
      expect(current?.slot).toBe(532);
      expect(onFinalized).toHaveBeenCalledWith(
        expect.objectContaining({ state: "finalized", slot: 532 }),
      );
      expect(mockRemoveSignatureListener).toHaveBeenCalled();
    });
  });

  describe("Rollback mechanisms", () => {
    it("rolls back to available with user-friendly error message if transaction fails on-chain", async () => {
      const onError = jest.fn();
      const onRollback = jest.fn();
      const onStateChange = jest.fn();

      await reserveSeatOptimistically({
        connection: mockConnection as Connection,
        seatId: "seat-failed",
        venueId: "venue-1",
        signature: "sig_failed",
        payerWallet: "wallet-1",
        amount: 1,
        callbacks: {
          onError,
          onRollback,
          onStateChange,
        },
      });

      // Trigger confirmed with on-chain error
      triggerSignatureNotification("confirmed", {
        InstructionError: [0, "Custom(1)"],
      });

      const state = getSeatReservationState("seat-failed");
      expect(state?.state).toBe("available");
      expect(state?.paymentStatus).toBe("failed");
      expect(state?.error).toContain("Transaction failed on-chain");
      expect(state?.error).toContain("Custom(1)");

      expect(onError).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({
          state: "available",
          paymentStatus: "failed",
        }),
      );
      expect(onRollback).toHaveBeenCalledWith(
        expect.stringContaining("Transaction failed on-chain"),
        expect.objectContaining({ state: "available" }),
      );
      expect(mockRemoveSignatureListener).toHaveBeenCalled();
    });

    it("rolls back to available after 60 seconds if dropped from mempool", async () => {
      const onError = jest.fn();
      const onRollback = jest.fn();

      await reserveSeatOptimistically({
        connection: mockConnection as Connection,
        seatId: "seat-timeout",
        venueId: "venue-1",
        signature: "sig_timeout",
        payerWallet: "wallet-1",
        amount: 1,
        callbacks: {
          onError,
          onRollback,
        },
      });

      // State is provisionally reserved initially
      expect(getSeatReservationState("seat-timeout")?.state).toBe(
        "provisionally_reserved",
      );

      // Advance clock by 59 seconds — still waiting
      jest.advanceTimersByTime(59_000);
      expect(getSeatReservationState("seat-timeout")?.state).toBe(
        "provisionally_reserved",
      );

      // Advance clock past 60 seconds
      jest.advanceTimersByTime(1_500);

      const state = getSeatReservationState("seat-timeout");
      expect(state?.state).toBe("available");
      expect(state?.paymentStatus).toBe("timeout");
      expect(state?.error).toContain(
        "timed out after 60 seconds (dropped from mempool)",
      );
      expect(state?.error).toContain("restored to available");

      expect(onError).toHaveBeenCalled();
      expect(onRollback).toHaveBeenCalledWith(
        expect.stringContaining("timed out after 60 seconds"),
        expect.objectContaining({ state: "available" }),
      );
      expect(mockRemoveSignatureListener).toHaveBeenCalled();
    });

    it("supports manual rollback via rollbackSeatReservation", async () => {
      await reserveSeatOptimistically({
        connection: mockConnection as Connection,
        seatId: "seat-manual",
        venueId: "venue-1",
        signature: "sig_manual",
        payerWallet: "wallet-1",
        amount: 1,
      });

      const rolledBack = rollbackSeatReservation(
        "seat-manual",
        "User cancelled transaction in wallet dialog",
      );

      expect(rolledBack?.state).toBe("available");
      expect(rolledBack?.paymentStatus).toBe("failed");
      expect(rolledBack?.error).toBe(
        "User cancelled transaction in wallet dialog",
      );
      expect(getSeatReservationState("seat-manual")?.state).toBe("available");
      expect(mockRemoveSignatureListener).toHaveBeenCalled();
    });
  });

  describe("Proof of Work anti-spam integration", () => {
    it("validates Proof of Work when powSubmission is provided", async () => {
      const validator = new ProofOfWorkValidator();
      const now = Date.now();
      const merkleRoot = "root_test_123";

      // Find a nonce that satisfies difficulty 1 (leading zero)
      let nonce = 0;
      let validSubmission: PoWSubmission | null = null;
      while (nonce < 1000) {
        const sub: PoWSubmission = {
          merkleRoot,
          nonce: String(nonce),
          difficulty: 1,
          timestamp: now,
        };
        if (validator.validate(sub)) {
          validSubmission = sub;
          break;
        }
        nonce++;
      }

      expect(validSubmission).not.toBeNull();

      // Valid PoW allows reservation
      const res = await reserveSeatOptimistically({
        connection: mockConnection as Connection,
        seatId: "seat-pow-valid",
        venueId: "venue-1",
        signature: "sig_pow_valid",
        payerWallet: "wallet-1",
        amount: 1,
        powSubmission: validSubmission!,
      });

      expect(res.state).toBe("provisionally_reserved");

      // Invalid PoW rejects reservation
      const invalidSubmission: PoWSubmission = {
        merkleRoot: "fake_root",
        nonce: "invalid_nonce_999999",
        difficulty: 8, // Very high difficulty impossible to pass with random string
        timestamp: now,
      };

      await expect(
        reserveSeatOptimistically({
          connection: mockConnection as Connection,
          seatId: "seat-pow-invalid",
          venueId: "venue-1",
          signature: "sig_pow_invalid",
          payerWallet: "wallet-1",
          amount: 1,
          powSubmission: invalidSubmission,
        }),
      ).rejects.toThrow("Invalid Proof-of-Work");
    });
  });

  describe("Slot expiration & dynamic retry lifecycle (#9635)", () => {
    describe("Priority fee & blockhash helpers", () => {
      it("calculates stepped micro-lamport priority fee across retry attempts", () => {
        expect(calculatePriorityFeeForAttempt(5_000, 0)).toBe(5_000);
        expect(calculatePriorityFeeForAttempt(5_000, 1, 1.5)).toBe(7_500);
        expect(calculatePriorityFeeForAttempt(5_000, 2, 1.5)).toBe(11_250);
        expect(calculatePriorityFeeForAttempt(500_000, 3, 1.5, 1_000_000)).toBe(
          1_000_000,
        );
      });

      it("detects blockhash and slot expiration error variants", () => {
        expect(isBlockhashExpiredError("Blockhash not found")).toBe(true);
        expect(
          isBlockhashExpiredError("TransactionExpiredBlockheightExceededError"),
        ).toBe(true);
        expect(
          isBlockhashExpiredError(new Error("blockhash has expired")),
        ).toBe(true);
        expect(
          isBlockhashExpiredError({ message: "BlockheightExceeded" }),
        ).toBe(true);
        expect(isBlockhashExpiredError("InstructionError: Custom(1)")).toBe(
          false,
        );
        expect(isBlockhashExpiredError(null)).toBe(false);
      });

      it("verifies blockheight expiration against current cluster block height", async () => {
        const mockConn = {
          getBlockHeight: jest.fn().mockResolvedValue(200_150),
        } as unknown as Connection;

        const notExpired = await verifyBlockheightExpiration(mockConn, 200_200);
        expect(notExpired.expired).toBe(false);
        expect(notExpired.currentBlockHeight).toBe(200_150);

        const expired = await verifyBlockheightExpiration(mockConn, 200_100);
        expect(expired.expired).toBe(true);
        expect(expired.currentBlockHeight).toBe(200_150);
      });

      it("fetches latest blockhash with exponential backoff on transient errors", async () => {
        jest.useRealTimers();
        try {
          const mockConn = {
            getLatestBlockhash: jest
              .fn()
              .mockRejectedValueOnce(new Error("429 Too Many Requests"))
              .mockResolvedValueOnce({
                blockhash: "fresh_blockhash_123",
                lastValidBlockHeight: 300_000,
              }),
          } as unknown as Connection;

          const result = await fetchLatestBlockhashWithBackoff(mockConn, 3, 10);
          expect(result.blockhash).toBe("fresh_blockhash_123");
          expect(result.lastValidBlockHeight).toBe(300_000);
          expect(mockConn.getLatestBlockhash).toHaveBeenCalledTimes(2);
        } finally {
          jest.useFakeTimers();
        }
      });
    });

    describe("Clock drift & slot lag handling", () => {
      it("does not prematurely roll back when blockhash is still valid on-chain despite timeout", async () => {
        mockConnection.getBlockHeight = jest.fn().mockResolvedValue(100_050);

        const onRollback = jest.fn();
        await reserveSeatOptimistically({
          connection: mockConnection as Connection,
          seatId: "seat-drift-1",
          venueId: "venue-drift",
          signature: "sig_drift_1",
          payerWallet: "wallet-drift",
          amount: 1,
          timeoutMs: 10_000,
          lastValidBlockHeight: 100_200, // Still valid (100_050 <= 100_200)
          callbacks: { onRollback },
        });

        expect(getSeatReservationState("seat-drift-1")?.state).toBe(
          "provisionally_reserved",
        );

        // Advance past initial 10s timeout
        await jest.advanceTimersByTimeAsync(11_000);

        // Should NOT roll back because blockhash has not expired on-chain
        expect(onRollback).not.toHaveBeenCalled();
        expect(getSeatReservationState("seat-drift-1")?.state).toBe(
          "provisionally_reserved",
        );
      });
    });

    describe("Automatic retry and re-signing lifecycle", () => {
      it("re-queries blockhash and retries transaction broadcast before failing", async () => {
        mockConnection.getBlockHeight = jest.fn().mockResolvedValue(100_300);
        mockConnection.getLatestBlockhash = jest.fn().mockResolvedValue({
          blockhash: "fresh_blockhash_retry_1",
          lastValidBlockHeight: 100_450,
        });

        const resubmitTransaction = jest
          .fn()
          .mockResolvedValue("sig_retry_success");
        const onRetry = jest.fn();
        const onStateChange = jest.fn();
        const onConfirmed = jest.fn();

        await reserveSeatOptimistically({
          connection: mockConnection as Connection,
          seatId: "seat-retry-1",
          venueId: "venue-retry",
          signature: "sig_initial_stale",
          payerWallet: "wallet-retry",
          amount: 1,
          timeoutMs: 5_000,
          lastValidBlockHeight: 100_200, // Expired (100_300 > 100_200)
          recentBlockhash: "stale_hash",
          retryConfig: {
            maxRetries: 2,
            baseBackoffMs: 100,
            priorityFeeMicroLamports: 5_000,
            feeBumpMultiplier: 1.5,
          },
          resubmitTransaction,
          callbacks: { onRetry, onStateChange, onConfirmed },
        });

        // Trigger timeout & expiration check
        await jest.advanceTimersByTimeAsync(6_000);

        expect(onRetry).toHaveBeenCalledWith(
          1,
          expect.stringContaining(
            "Re-querying fresh blockhash with exponential backoff",
          ),
          expect.anything(),
        );
        expect(resubmitTransaction).toHaveBeenCalledWith(
          "fresh_blockhash_retry_1",
          100_450,
          7_500, // 5000 * 1.5 = 7500
        );

        // State updated to new signature
        const state = getSeatReservationState("seat-retry-1");
        expect(state?.signature).toBe("sig_retry_success");
        expect(state?.retryAttempt).toBe(1);
        expect(state?.state).toBe("provisionally_reserved");

        // Now confirm the retried transaction
        triggerSignatureNotification("confirmed", null, 100_400);

        expect(getSeatReservationState("seat-retry-1")?.state).toBe(
          "confirmed",
        );
        expect(onConfirmed).toHaveBeenCalled();
      });

      it("gracefully rolls back when retries are exhausted", async () => {
        mockConnection.getBlockHeight = jest.fn().mockResolvedValue(200_000);
        mockConnection.getLatestBlockhash = jest.fn().mockResolvedValue({
          blockhash: "fresh_hash_each_attempt",
          lastValidBlockHeight: 200_100,
        });

        const resubmitTransaction = jest
          .fn()
          .mockRejectedValue(
            new Error("TransactionExpiredBlockheightExceededError"),
          );
        const onRollback = jest.fn();

        await reserveSeatOptimistically({
          connection: mockConnection as Connection,
          seatId: "seat-exhaust-1",
          venueId: "venue-exhaust",
          signature: "sig_exhaust_0",
          payerWallet: "wallet-exhaust",
          amount: 1,
          timeoutMs: 2_000,
          lastValidBlockHeight: 199_000, // Already expired
          retryConfig: {
            maxRetries: 1,
            baseBackoffMs: 50,
          },
          resubmitTransaction,
          callbacks: { onRollback },
        });

        await jest.advanceTimersByTimeAsync(3_000);
        await jest.advanceTimersByTimeAsync(3_000);

        const state = getSeatReservationState("seat-exhaust-1");
        expect(state?.state).toBe("available");
        expect(state?.paymentStatus).toBe("timeout");
        expect(onRollback).toHaveBeenCalled();
      });
    });
  });
});

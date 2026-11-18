/**
 * Tests for optimistic UI updates and WebSocket confirmation listener for Solana Pay seat bookings (#7169).
 */

import {
  solanaPayEscrowManager,
  reserveSeatOptimistically,
  rollbackSeatReservation,
  getSeatReservationState,
  resetSeatReservations,
  DEFAULT_CONFIRMATION_TIMEOUT_MS,
  type SeatReservationState,
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
      onSignatureWithOptions: jest.fn().mockImplementation(
        (signature: string, callback: any, options: { commitment: string }) => {
          const id = subCounter++;
          signatureCallbacks.set(id, {
            signature,
            callback,
            commitment: options?.commitment ?? "confirmed",
          });
          return id;
        },
      ),
      removeSignatureListener: mockRemoveSignatureListener.mockResolvedValue(undefined),
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
      triggerSignatureNotification("confirmed", { InstructionError: [0, "Custom(1)"] });

      const state = getSeatReservationState("seat-failed");
      expect(state?.state).toBe("available");
      expect(state?.paymentStatus).toBe("failed");
      expect(state?.error).toContain("Transaction failed on-chain");
      expect(state?.error).toContain("Custom(1)");

      expect(onError).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({ state: "available", paymentStatus: "failed" }),
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
      expect(getSeatReservationState("seat-timeout")?.state).toBe("provisionally_reserved");

      // Advance clock by 59 seconds — still waiting
      jest.advanceTimersByTime(59_000);
      expect(getSeatReservationState("seat-timeout")?.state).toBe("provisionally_reserved");

      // Advance clock past 60 seconds
      jest.advanceTimersByTime(1_500);

      const state = getSeatReservationState("seat-timeout");
      expect(state?.state).toBe("available");
      expect(state?.paymentStatus).toBe("timeout");
      expect(state?.error).toContain("timed out after 60 seconds (dropped from mempool)");
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
      expect(rolledBack?.error).toBe("User cancelled transaction in wallet dialog");
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
});

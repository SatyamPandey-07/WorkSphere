/**
 * solanaPayEscrow.ts
 *
 * Implements optimistic UI updates and WebSocket confirmation listener for Solana Pay seat bookings.
 * Enhances seat reservation payments so transactions update the UI optimistically while subscribing
 * to Solana RPC WebSocket commitment notifications (confirmed -> finalized).
 *
 * Features:
 * 1. Transition seat state to provisionally_reserved immediately upon wallet signature approval.
 * 2. Subscribe to RPC onSignatureWithOptions WebSocket for transaction confirmation.
 * 3. Roll back to available with user-friendly error message if the transaction fails or drops from mempool after 60 seconds.
 * 4. Anti-spam Proof-of-Work validation support using ProofOfWorkValidator.
 */

import type { Connection, Commitment } from "@solana/web3.js";
import {
  ProofOfWorkValidator,
  type PoWSubmission,
} from "@/core/ledger/ProofOfWorkValidator";

export const DEFAULT_CONFIRMATION_TIMEOUT_MS = 60_000; // 60 seconds

export type SeatState =
  | "available"
  | "provisionally_reserved"
  | "confirmed"
  | "finalized";

export type PaymentConfirmationStage =
  | "pending"
  | "confirmed"
  | "finalized"
  | "failed"
  | "timeout";

export interface SeatReservationState {
  seatId: string;
  venueId: string;
  state: SeatState;
  paymentStatus: PaymentConfirmationStage;
  signature?: string;
  payerWallet?: string;
  amount?: number;
  currency?: "SOL" | "USDC";
  error?: string | null;
  slot?: number;
  updatedAt: number;
}

export interface SeatReservationCallbacks {
  onStateChange?: (state: SeatReservationState) => void;
  onProvisionallyReserved?: (state: SeatReservationState) => void;
  onConfirmed?: (state: SeatReservationState) => void;
  onFinalized?: (state: SeatReservationState) => void;
  onError?: (error: Error, state: SeatReservationState) => void;
  onRollback?: (reason: string, state: SeatReservationState) => void;
}

export interface ReserveSeatOptions {
  connection: Connection;
  seatId: string;
  venueId: string;
  signature: string;
  payerWallet: string;
  amount: number;
  currency?: "SOL" | "USDC";
  timeoutMs?: number;
  powSubmission?: PoWSubmission;
  callbacks?: SeatReservationCallbacks;
}

interface ActiveSubscription {
  seatId: string;
  signature: string;
  confirmedSubId?: number;
  finalizedSubId?: number;
  timeoutTimer?: ReturnType<typeof setTimeout>;
  connection: Connection;
  callbacks?: SeatReservationCallbacks;
}

export class SolanaPayEscrowManager {
  private reservations: Map<string, SeatReservationState> = new Map();
  private activeSubscriptions: Map<string, ActiveSubscription> = new Map();
  private powValidator: ProofOfWorkValidator;

  constructor(powValidator?: ProofOfWorkValidator) {
    this.powValidator = powValidator || new ProofOfWorkValidator();
  }

  /**
   * Validates optional Proof-of-Work submission to protect seat reservations against spam/bots.
   */
  public validatePoW(submission: PoWSubmission): boolean {
    return this.powValidator.validate(submission);
  }

  /**
   * Gets current state of a seat reservation.
   */
  public getSeatState(seatId: string): SeatReservationState | null {
    return this.reservations.get(seatId) ?? null;
  }

  /**
   * Gets all active reservations.
   */
  public getAllReservations(): Map<string, SeatReservationState> {
    return new Map(this.reservations);
  }

  /**
   * Resets all internal state and clears all active WebSocket listeners and timers.
   */
  public reset(): void {
    for (const [seatId] of this.activeSubscriptions) {
      this.cleanupSubscription(seatId);
    }
    this.activeSubscriptions.clear();
    this.reservations.clear();
  }

  /**
   * Optimistically reserves a seat and initiates WebSocket commitment listeners.
   */
  public async reserveSeatOptimistically(
    options: ReserveSeatOptions,
  ): Promise<SeatReservationState> {
    const {
      connection,
      seatId,
      venueId,
      signature,
      payerWallet,
      amount,
      currency = "SOL",
      timeoutMs = DEFAULT_CONFIRMATION_TIMEOUT_MS,
      powSubmission,
      callbacks,
    } = options;

    if (!seatId || typeof seatId !== "string" || !seatId.trim()) {
      throw new Error("seatId is required");
    }
    if (!venueId || typeof venueId !== "string" || !venueId.trim()) {
      throw new Error("venueId is required");
    }
    if (!signature || typeof signature !== "string" || !signature.trim()) {
      throw new Error("Transaction signature is required");
    }
    if (!payerWallet || typeof payerWallet !== "string" || !payerWallet.trim()) {
      throw new Error("payerWallet address is required");
    }

    // Anti-spam PoW check if provided
    if (powSubmission) {
      const isValid = this.validatePoW(powSubmission);
      if (!isValid) {
        throw new Error("Invalid Proof-of-Work: anti-spam challenge validation failed");
      }
    }

    // Check if already reserved
    const existing = this.reservations.get(seatId);
    if (
      existing &&
      (existing.state === "provisionally_reserved" ||
        existing.state === "confirmed" ||
        existing.state === "finalized")
    ) {
      if (existing.signature !== signature) {
        throw new Error(
          `Seat ${seatId} is already ${existing.state}. Cannot override with new reservation.`,
        );
      }
    }

    // 1. Transition state to provisionally_reserved immediately upon signature approval
    const initialState: SeatReservationState = {
      seatId,
      venueId,
      state: "provisionally_reserved",
      paymentStatus: "pending",
      signature,
      payerWallet,
      amount,
      currency,
      error: null,
      updatedAt: Date.now(),
    };

    this.reservations.set(seatId, initialState);

    // Notify UI immediately so reservation feels instantaneous
    try {
      callbacks?.onStateChange?.(initialState);
      callbacks?.onProvisionallyReserved?.(initialState);
    } catch (err) {
      console.error("[SolanaPayEscrow] Error in optimistic callback:", err);
    }

    // Clean up any stale subscription for this seat before starting a new one
    this.cleanupSubscription(seatId);

    // 2. Subscribe to RPC onSignatureWithOptions WebSocket & start 60s timeout
    this.subscribeToSignatureUpdates(
      connection,
      seatId,
      signature,
      timeoutMs,
      callbacks,
    );

    return initialState;
  }

  /**
   * Subscribes to Solana RPC WebSocket commitment notifications (confirmed -> finalized).
   */
  private subscribeToSignatureUpdates(
    connection: Connection,
    seatId: string,
    signature: string,
    timeoutMs: number,
    callbacks?: SeatReservationCallbacks,
  ): void {
    const subRecord: ActiveSubscription = {
      seatId,
      signature,
      connection,
      callbacks,
    };

    // 3. 60-Second timeout: rollback to available if transaction drops from mempool
    subRecord.timeoutTimer = setTimeout(() => {
      const timeoutReason =
        `Transaction confirmation timed out after ${Math.round(timeoutMs / 1000)} seconds ` +
        `(dropped from mempool). Seat reservation has been restored to available.`;
      this.rollback(seatId, timeoutReason, "timeout");
    }, timeoutMs);
    subRecord.timeoutTimer.unref?.();

    // Handle WebSocket listener for 'confirmed' commitment
    try {
      subRecord.confirmedSubId = connection.onSignatureWithOptions(
        signature,
        (notification, context) => {
          if (notification.err) {
            const errorMsg =
              typeof notification.err === "string"
                ? notification.err
                : JSON.stringify(notification.err);
            const reason = `Transaction failed on-chain: ${errorMsg}. Seat reservation reverted to available.`;
            this.rollback(seatId, reason, "failed");
            return;
          }

          // Transition to confirmed
          const current = this.reservations.get(seatId);
          if (current && current.state === "provisionally_reserved") {
            const confirmedState: SeatReservationState = {
              ...current,
              state: "confirmed",
              paymentStatus: "confirmed",
              slot: context?.slot,
              error: null,
              updatedAt: Date.now(),
            };
            this.reservations.set(seatId, confirmedState);

            try {
              callbacks?.onStateChange?.(confirmedState);
              callbacks?.onConfirmed?.(confirmedState);
            } catch (err) {
              console.error("[SolanaPayEscrow] Error in confirmed callback:", err);
            }
          }
        },
        { commitment: "confirmed" },
      );
    } catch (err) {
      console.error("[SolanaPayEscrow] Failed to subscribe to confirmed notification:", err);
    }

    // Handle WebSocket listener for 'finalized' commitment
    try {
      subRecord.finalizedSubId = connection.onSignatureWithOptions(
        signature,
        (notification, context) => {
          if (notification.err) {
            const errorMsg =
              typeof notification.err === "string"
                ? notification.err
                : JSON.stringify(notification.err);
            const reason = `Transaction failed on-chain during finalization: ${errorMsg}. Seat reservation reverted to available.`;
            this.rollback(seatId, reason, "failed");
            return;
          }

          // Transition to finalized
          const current = this.reservations.get(seatId);
          if (current && (current.state === "provisionally_reserved" || current.state === "confirmed")) {
            const finalizedState: SeatReservationState = {
              ...current,
              state: "finalized",
              paymentStatus: "finalized",
              slot: context?.slot,
              error: null,
              updatedAt: Date.now(),
            };
            this.reservations.set(seatId, finalizedState);

            // Successfully finalized, clear subscriptions and timers
            this.cleanupSubscription(seatId);

            try {
              callbacks?.onStateChange?.(finalizedState);
              callbacks?.onFinalized?.(finalizedState);
            } catch (err) {
              console.error("[SolanaPayEscrow] Error in finalized callback:", err);
            }
          }
        },
        { commitment: "finalized" },
      );
    } catch (err) {
      console.error("[SolanaPayEscrow] Failed to subscribe to finalized notification:", err);
    }

    this.activeSubscriptions.set(seatId, subRecord);
  }

  /**
   * Rolls back seat reservation to "available" with a user-friendly error message.
   */
  public rollback(
    seatId: string,
    reason: string,
    status: PaymentConfirmationStage = "failed",
  ): SeatReservationState | null {
    const current = this.reservations.get(seatId);
    const sub = this.activeSubscriptions.get(seatId);
    const callbacks = sub?.callbacks;

    // Clean up active WebSocket listeners and timers
    this.cleanupSubscription(seatId);

    const rolledBackState: SeatReservationState = {
      seatId,
      venueId: current?.venueId ?? "",
      state: "available",
      paymentStatus: status,
      signature: current?.signature,
      payerWallet: current?.payerWallet,
      amount: current?.amount,
      currency: current?.currency,
      error: reason,
      updatedAt: Date.now(),
    };

    this.reservations.set(seatId, rolledBackState);

    const err = new Error(reason);
    try {
      callbacks?.onError?.(err, rolledBackState);
      callbacks?.onRollback?.(reason, rolledBackState);
      callbacks?.onStateChange?.(rolledBackState);
    } catch (callbackErr) {
      console.error("[SolanaPayEscrow] Error in rollback callback:", callbackErr);
    }

    return rolledBackState;
  }

  /**
   * Cleans up WebSocket subscriptions and timeout timers for a seat.
   */
  private cleanupSubscription(seatId: string): void {
    const sub = this.activeSubscriptions.get(seatId);
    if (!sub) return;

    if (sub.timeoutTimer) {
      clearTimeout(sub.timeoutTimer);
      sub.timeoutTimer = undefined;
    }

    if (sub.confirmedSubId !== undefined) {
      try {
        Promise.resolve(
          sub.connection.removeSignatureListener(sub.confirmedSubId),
        ).catch(() => {});
      } catch {
        // Ignore unhandled connection close errors
      }
      sub.confirmedSubId = undefined;
    }

    if (sub.finalizedSubId !== undefined) {
      try {
        Promise.resolve(
          sub.connection.removeSignatureListener(sub.finalizedSubId),
        ).catch(() => {});
      } catch {
        // Ignore unhandled connection close errors
      }
      sub.finalizedSubId = undefined;
    }

    this.activeSubscriptions.delete(seatId);
  }
}

// Global default singleton instance
export const solanaPayEscrowManager = new SolanaPayEscrowManager();

/**
 * Convenience functions
 */
export async function reserveSeatOptimistically(
  options: ReserveSeatOptions,
): Promise<SeatReservationState> {
  return solanaPayEscrowManager.reserveSeatOptimistically(options);
}

export function rollbackSeatReservation(
  seatId: string,
  reason: string,
  status: PaymentConfirmationStage = "failed",
): SeatReservationState | null {
  return solanaPayEscrowManager.rollback(seatId, reason, status);
}

export function getSeatReservationState(
  seatId: string,
): SeatReservationState | null {
  return solanaPayEscrowManager.getSeatState(seatId);
}

export function resetSeatReservations(): void {
  solanaPayEscrowManager.reset();
}

export function validateSeatReservationPoW(submission: PoWSubmission): boolean {
  return solanaPayEscrowManager.validatePoW(submission);
}

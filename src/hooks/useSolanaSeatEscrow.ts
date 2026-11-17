"use client";

import { useState, useCallback, useRef } from "react";
import type { Connection } from "@solana/web3.js";
import {
  reserveSeatOptimistically,
  rollbackSeatReservation,
  getSeatReservationState,
  type SeatReservationState,
  type SeatState,
  type PaymentConfirmationStage,
} from "@/lib/solana/solanaPayEscrow";
import type { PoWSubmission } from "@/core/ledger/ProofOfWorkValidator";

export interface UseSolanaSeatEscrowOptions {
  seatId?: string;
  venueId?: string;
  onStateChange?: (state: SeatReservationState) => void;
  onConfirmed?: (state: SeatReservationState) => void;
  onFinalized?: (state: SeatReservationState) => void;
  onError?: (error: Error, state: SeatReservationState) => void;
  onRollback?: (reason: string, state: SeatReservationState) => void;
}

export function useSolanaSeatEscrow(options?: UseSolanaSeatEscrowOptions) {
  const [state, setState] = useState<SeatReservationState | null>(() => {
    return options?.seatId ? getSeatReservationState(options.seatId) : null;
  });

  const callbacksRef = useRef(options);
  callbacksRef.current = options;

  const reserve = useCallback(
    async (params: {
      connection: Connection;
      seatId: string;
      venueId: string;
      signature: string;
      payerWallet: string;
      amount: number;
      currency?: "SOL" | "USDC";
      timeoutMs?: number;
      powSubmission?: PoWSubmission;
    }) => {
      return reserveSeatOptimistically({
        ...params,
        callbacks: {
          onStateChange: (newState) => {
            setState(newState);
            callbacksRef.current?.onStateChange?.(newState);
          },
          onConfirmed: (newState) => {
            setState(newState);
            callbacksRef.current?.onConfirmed?.(newState);
          },
          onFinalized: (newState) => {
            setState(newState);
            callbacksRef.current?.onFinalized?.(newState);
          },
          onError: (err, newState) => {
            setState(newState);
            callbacksRef.current?.onError?.(err, newState);
          },
          onRollback: (reason, newState) => {
            setState(newState);
            callbacksRef.current?.onRollback?.(reason, newState);
          },
        },
      });
    },
    [],
  );

  const rollback = useCallback((seatId: string, reason: string) => {
    const rolledBack = rollbackSeatReservation(seatId, reason);
    if (rolledBack) {
      setState(rolledBack);
    }
    return rolledBack;
  }, []);

  return {
    reservation: state,
    seatState: state?.state ?? ("available" as SeatState),
    paymentStatus: state?.paymentStatus ?? ("pending" as PaymentConfirmationStage),
    isProvisionallyReserved: state?.state === "provisionally_reserved",
    isConfirmed: state?.state === "confirmed",
    isFinalized: state?.state === "finalized",
    isAvailable: !state || state.state === "available",
    error: state?.error ?? null,
    reserveSeat: reserve,
    rollbackSeat: rollback,
  };
}

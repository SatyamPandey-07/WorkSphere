"use client";

import { useState } from "react";
import { Connection, Transaction } from "@solana/web3.js";
import {
  simulateEscrowTransaction,
  reconcilePendingSignature,
} from "@/lib/solana/escrowClient";

export type EscrowStatus = "idle" | "simulating" | "confirmed_optimistic" | "finalized" | "error";

export function useNomadEscrow(rpcUrl: string = "https://api.mainnet-beta.solana.com") {
  const [status, setStatus] = useState<EscrowStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pendingSignature, setPendingSignature] = useState<string | null>(null);

  const executeEscrowTransaction = async (
    transaction: Transaction,
    sendTransactionFn: (tx: Transaction) => Promise<string>
  ) => {
    setStatus("simulating");
    setErrorMessage(null);
    const connection = new Connection(rpcUrl, "confirmed");

    // 1. Client-Side RPC Simulation (<50ms)
    const simResult = await simulateEscrowTransaction(connection, transaction);

    if (!simResult.success) {
      setStatus("error");
      setErrorMessage(simResult.error || "Transaction simulation failed (e.g. slippage exceeded).");
      return { success: false, error: simResult.error };
    }

    // 2. Submit transaction to RPC nodes & Apply Optimistic UI Transition (<50ms)
    try {
      const signature = await sendTransactionFn(transaction);
      setPendingSignature(signature);
      setStatus("confirmed_optimistic");

      // 3. Background Signature Reconciliation Worker
      reconcilePendingSignature({ signature, connection }).then((isFinalized) => {
        if (isFinalized) {
          setStatus("finalized");
        } else {
          // Revert optimistic mutation on on-chain drop / blockhash expiration
          setStatus("error");
          setErrorMessage("Transaction dropped or expired on-chain. Please retry.");
        }
      });

      return { success: true, signature };
    } catch (err: any) {
      setStatus("error");
      setErrorMessage(err.message || "Failed to submit transaction.");
      return { success: false, error: err.message };
    }
  };

  return {
    status,
    errorMessage,
    pendingSignature,
    executeEscrowTransaction,
  };
}
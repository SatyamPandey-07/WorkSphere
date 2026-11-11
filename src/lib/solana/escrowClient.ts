import { Connection, Transaction, VersionedTransaction } from "@solana/web3.js";

export interface SimulationResult {
  success: boolean;
  logs: string[];
  error?: string;
}

export interface ReconcileOptions {
  signature: string;
  connection: Connection;
  maxRetries?: number;
  retryIntervalMs?: number;
}

/**
 * Simulates a signed Solana transaction on RPC nodes before broadcasting.
 */
export async function simulateEscrowTransaction(
  connection: Connection,
  transaction: Transaction | VersionedTransaction
): Promise<SimulationResult> {
  try {
    const res = await connection.simulateTransaction(transaction as any);
    if (res.value.err) {
      return {
        success: false,
        logs: res.value.logs || [],
        error: JSON.stringify(res.value.err),
      };
    }
    return {
      success: true,
      logs: res.value.logs || [],
    };
  } catch (err: any) {
    return {
      success: false,
      logs: [],
      error: err.message || "RPC Simulation failed",
    };
  }
}

/**
 * Background worker verifying on-chain transaction finalization.
 */
export async function reconcilePendingSignature({
  signature,
  connection,
  maxRetries = 30,
  retryIntervalMs = 1000,
}: ReconcileOptions): Promise<boolean> {
  let attempts = 0;
  while (attempts < maxRetries) {
    try {
      const status = await connection.getSignatureStatus(signature, {
        searchTransactionHistory: true,
      });

      const confirmation = status.value;
      if (confirmation) {
        if (confirmation.err) {
          console.error(`[Solana Reconciler] Transaction ${signature} failed on-chain:`, confirmation.err);
          return false;
        }
        if (
          confirmation.confirmationStatus === "confirmed" ||
          confirmation.confirmationStatus === "finalized"
        ) {
          return true;
        }
      }
    } catch (err) {
      console.warn(`[Solana Reconciler] Poll attempt ${attempts + 1} failed:`, err);
    }

    attempts++;
    await new Promise((resolve) => setTimeout(resolve, retryIntervalMs));
  }
  return false;
}
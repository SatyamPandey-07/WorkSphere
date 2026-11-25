/**
 * Automatic Retry Pipeline with Dynamic Priority Fee Stepping for Solana Escrow Transactions (#7848).
 *
 * Implements a resilient transaction submission and stepped fee replacement pipeline:
 * - Computes dynamic priority fees using `PriorityFeeEstimator`.
 * - Appends or updates `ComputeBudgetProgram.setComputeUnitPrice({ microLamports })`.
 * - Broadcasts transactions with safety checks.
 * - Confirms transactions via `subscribeToEscrowConfirmation` or HTTP status polling.
 * - Safely verifies previous transaction blockhash expiry and status before creating a replacement.
 * - Prevents double execution and ensures idempotent progression.
 */

import {
  ComputeBudgetProgram,
  Connection,
  Transaction,
  type TransactionInstruction,
} from "@solana/web3.js";
import {
  PriorityFeeEstimator,
  getPriorityFeeEstimator,
  type PriorityFeeEstimate,
  type PriorityFeeConfig,
} from "./priorityFeeEstimator";
import {
  subscribeToEscrowConfirmation,
  type EscrowConfirmationStatus,
  type EscrowRpcConnectionPool,
} from "./escrowClient";

export interface EscrowRetryConfig {
  /** Maximum number of retry attempts before giving up (default: 3). */
  maxRetries?: number;
  /** Multiplier applied to previous priority fee on each retry attempt (default: 1.5). */
  feeBumpMultiplier?: number;
  /** Fixed additive micro-lamports bump on each retry attempt (default: 0). */
  feeBumpAddMicroLamports?: number;
  /** Minimum priority fee in micro-lamports (default: 1,000). */
  minMicroLamports?: number;
  /** Hard cap on priority fee in micro-lamports (default: 1,000,000). */
  maxMicroLamports?: number;
  /** Fallback fee in micro-lamports when estimation fails (default: 5,000). */
  fallbackMicroLamports?: number;
  /** Per-attempt confirmation timeout in ms before considering replacement (default: 15,000ms). */
  attemptConfirmationTimeoutMs?: number;
  /** Base delay in ms between retries (default: 2,000ms). */
  retryDelayMs?: number;
  /** Priority fee estimation options. */
  feeConfig?: PriorityFeeConfig;
}

export const DEFAULT_MAX_ESCROW_RETRIES = 3;
export const DEFAULT_FEE_BUMP_MULTIPLIER = 1.5;
export const DEFAULT_ATTEMPT_CONFIRMATION_TIMEOUT_MS = 15_000;
export const DEFAULT_RETRY_DELAY_MS = 2_000;

export interface AttemptRecord {
  signature: string;
  attempt: number;
  priorityFeeMicroLamports: number;
  recentBlockhash?: string;
  lastValidBlockHeight?: number;
  submittedAt: number;
}

export interface EscrowTransactionContext {
  bookingId: string;
  attempt: number;
  previousSignatures: string[];
  activeSignature?: string;
  lastFeeEstimate?: PriorityFeeEstimate;
  effectivePriorityFeeMicroLamports: number;
  status:
    | "idle"
    | "estimating_fee"
    | "building"
    | "signing"
    | "broadcasting"
    | "confirming"
    | "retrying"
    | "confirmed"
    | "failed"
    | "timeout"
    | "unresolved";
  error?: string;
}

export interface EscrowRetryResult {
  success: boolean;
  signature: string;
  confirmedSlot?: number | null;
  attempts: number;
  allSignatures: string[];
  finalPriorityFeeMicroLamports: number;
  error?: string;
  unresolved?: boolean;
}

export type SignAndBroadcastCallback = (
  transaction: Transaction,
  attempt: number,
  priorityFeeMicroLamports: number,
) => Promise<{
  signature: string;
  recentBlockhash?: string;
  lastValidBlockHeight?: number;
}>;

export type TransactionBuilder = (
  priorityFeeMicroLamports: number,
  attempt: number,
) => Promise<Transaction>;

export type PriorTransactionStatus =
  | { status: "confirmed"; slot?: number | null }
  | { status: "failed"; error?: string }
  | { status: "pending"; confirmations?: number | null }
  | {
      status: "expired_not_found";
      currentBlockHeight: number;
      lastValidBlockHeight: number;
    }
  | { status: "unknown"; reason: string };

/**
 * Checks if an instruction is a ComputeBudgetProgram instruction with the given discriminator.
 * Discriminators:
 * - 0: RequestUnits (deprecated)
 * - 1: RequestHeapFrame
 * - 2: SetComputeUnitLimit
 * - 3: SetComputeUnitPrice
 */
export function isComputeBudgetInstruction(
  ix: TransactionInstruction,
  discriminator?: number,
): boolean {
  if (!ix || !ix.programId.equals(ComputeBudgetProgram.programId)) {
    return false;
  }
  if (discriminator === undefined) {
    return true;
  }
  return ix.data.length > 0 && ix.data[0] === discriminator;
}

/**
 * Injects or updates a ComputeBudgetProgram.setComputeUnitPrice instruction in the transaction.
 * Ensures:
 * 1. Validates that the transaction is a legacy Transaction with an instructions array.
 *    (Rejects VersionedTransaction with a typed error).
 * 2. Exactly one setComputeUnitPrice instruction is present.
 * 3. Placed at index 0 (or at the front with any setComputeUnitLimit instruction).
 * 4. Preserves all other transaction instructions in their exact order.
 */
export function injectOrUpdateComputeUnitPrice(
  transaction: Transaction,
  microLamports: number,
): Transaction {
  if (!transaction || !Array.isArray(transaction.instructions)) {
    throw new TypeError(
      "injectOrUpdateComputeUnitPrice requires a legacy Transaction instance with mutable instructions. For VersionedTransaction, inject compute budget instructions into the instructions array before compiling the message.",
    );
  }

  const safeFee = Math.max(0, Math.floor(microLamports));
  const newIx = ComputeBudgetProgram.setComputeUnitPrice({
    microLamports: safeFee,
  });

  const existingUnitPriceIndex = transaction.instructions.findIndex((ix) =>
    isComputeBudgetInstruction(ix, 3),
  );

  if (existingUnitPriceIndex >= 0) {
    transaction.instructions[existingUnitPriceIndex] = newIx;
  } else {
    // Insert at index 0 to ensure priority is recognized early in execution pipeline
    transaction.instructions.unshift(newIx);
  }

  return transaction;
}

/**
 * Pipeline to execute an escrow transaction with dynamic priority fee estimation and
 * an automatic retry pipeline with stepped fee bumps (#7848).
 */
export class EscrowTransactionRetryPipeline {
  private readonly connection: Connection;
  private readonly estimator: PriorityFeeEstimator;
  private readonly config: Required<EscrowRetryConfig>;

  constructor(
    connection: Connection,
    config: EscrowRetryConfig = {},
    estimator?: PriorityFeeEstimator,
  ) {
    this.connection = connection;
    this.estimator = estimator ?? getPriorityFeeEstimator(config.feeConfig);

    const minMicroLamports = config.minMicroLamports ?? 1_000;
    const maxMicroLamports = config.maxMicroLamports ?? 1_000_000;
    const fallbackMicroLamports = config.fallbackMicroLamports ?? 5_000;

    this.config = {
      maxRetries: config.maxRetries ?? DEFAULT_MAX_ESCROW_RETRIES,
      feeBumpMultiplier:
        config.feeBumpMultiplier ?? DEFAULT_FEE_BUMP_MULTIPLIER,
      feeBumpAddMicroLamports: config.feeBumpAddMicroLamports ?? 0,
      minMicroLamports,
      maxMicroLamports,
      fallbackMicroLamports,
      attemptConfirmationTimeoutMs:
        config.attemptConfirmationTimeoutMs ??
        DEFAULT_ATTEMPT_CONFIRMATION_TIMEOUT_MS,
      retryDelayMs: config.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS,
      feeConfig: config.feeConfig ?? {},
    };
  }

  /**
   * Calculates the stepped priority fee for a given attempt.
   */
  public calculateSteppedFee(
    baseEstimateMicroLamports: number,
    attempt: number,
  ): number {
    if (attempt <= 1) {
      return this.clampFee(baseEstimateMicroLamports);
    }

    let stepped = baseEstimateMicroLamports;
    for (let i = 1; i < attempt; i++) {
      stepped =
        Math.floor(stepped * this.config.feeBumpMultiplier) +
        this.config.feeBumpAddMicroLamports;
    }

    return this.clampFee(stepped);
  }

  private clampFee(fee: number): number {
    return Math.max(
      this.config.minMicroLamports,
      Math.min(this.config.maxMicroLamports, Math.floor(fee)),
    );
  }

  /**
   * Executes the retry pipeline with strict idempotency and blockhash expiration checks.
   */
  public async executeEscrowWithRetry(params: {
    bookingId: string;
    writableAccounts?: Array<any>;
    builder: TransactionBuilder;
    signer: SignAndBroadcastCallback;
    onProgress?: (ctx: EscrowTransactionContext) => void;
    pool?: EscrowRpcConnectionPool;
  }): Promise<EscrowRetryResult> {
    const { bookingId, writableAccounts, builder, signer, onProgress, pool } =
      params;
    const previousAttempts: AttemptRecord[] = [];
    const previousSignatures: string[] = [];

    // 1. Initial Priority Fee Estimation
    const feeEstimate = await this.estimator.estimatePriorityFee(
      this.connection,
      writableAccounts,
      {
        minMicroLamports: this.config.minMicroLamports,
        maxMicroLamports: this.config.maxMicroLamports,
        fallbackMicroLamports: this.config.fallbackMicroLamports,
      },
    );

    let currentAttempt = 1;
    const maxAttempts = this.config.maxRetries + 1; // 1 initial + maxRetries replacements

    while (currentAttempt <= maxAttempts) {
      const priorityFee = this.calculateSteppedFee(
        feeEstimate.microLamports,
        currentAttempt,
      );

      const ctx: EscrowTransactionContext = {
        bookingId,
        attempt: currentAttempt,
        previousSignatures: [...previousSignatures],
        lastFeeEstimate: feeEstimate,
        effectivePriorityFeeMicroLamports: priorityFee,
        status: "building",
      };
      onProgress?.(ctx);

      // 2. Build transaction with Compute Budget instruction
      let transaction: Transaction;
      try {
        transaction = await builder(priorityFee, currentAttempt);
        injectOrUpdateComputeUnitPrice(transaction, priorityFee);
      } catch (buildErr: any) {
        ctx.status = "failed";
        ctx.error = `Transaction build failed: ${buildErr?.message || buildErr}`;
        onProgress?.(ctx);
        return {
          success: false,
          signature: "",
          attempts: currentAttempt,
          allSignatures: previousSignatures,
          finalPriorityFeeMicroLamports: priorityFee,
          error: ctx.error,
        };
      }

      // 3. Sign & Broadcast
      ctx.status = "signing";
      onProgress?.(ctx);

      let attemptRecord: AttemptRecord;
      try {
        const signResult = await signer(
          transaction,
          currentAttempt,
          priorityFee,
        );
        const signature = signResult.signature;
        previousSignatures.push(signature);
        ctx.activeSignature = signature;
        ctx.status = "broadcasting";
        onProgress?.(ctx);

        attemptRecord = {
          signature,
          attempt: currentAttempt,
          priorityFeeMicroLamports: priorityFee,
          recentBlockhash: signResult.recentBlockhash,
          lastValidBlockHeight: signResult.lastValidBlockHeight,
          submittedAt: Date.now(),
        };
        previousAttempts.push(attemptRecord);
      } catch (signErr: any) {
        ctx.status = "failed";
        ctx.error = `Transaction signing/broadcast failed: ${signErr?.message || signErr}`;
        onProgress?.(ctx);

        // Check if error is deterministic (e.g. simulation failure, insufficient funds, user rejection)
        const errMsg = String(signErr?.message || signErr);
        if (
          errMsg.includes("insufficient funds") ||
          errMsg.includes("Simulation failure") ||
          errMsg.includes("custom program error") ||
          errMsg.includes("User rejected") ||
          errMsg.includes("cancelled by user")
        ) {
          return {
            success: false,
            signature: "",
            attempts: currentAttempt,
            allSignatures: previousSignatures,
            finalPriorityFeeMicroLamports: priorityFee,
            error: ctx.error,
          };
        }

        // Otherwise retry with backoff if attempts remaining
        if (currentAttempt < maxAttempts) {
          currentAttempt++;
          await new Promise((resolve) =>
            setTimeout(resolve, this.config.retryDelayMs),
          );
          continue;
        }

        return {
          success: false,
          signature: "",
          attempts: currentAttempt,
          allSignatures: previousSignatures,
          finalPriorityFeeMicroLamports: priorityFee,
          error: ctx.error,
        };
      }

      // 4. Confirmation Tracking with Disconnect Fallback
      ctx.status = "confirming";
      onProgress?.(ctx);

      const confirmResult = await this.awaitConfirmationWithTimeout(
        attemptRecord.signature,
        this.config.attemptConfirmationTimeoutMs,
        pool,
      );

      if (
        confirmResult.status === "confirmed" ||
        confirmResult.status === "finalized"
      ) {
        ctx.status = "confirmed";
        onProgress?.(ctx);
        return {
          success: true,
          signature: attemptRecord.signature,
          confirmedSlot: confirmResult.slot,
          attempts: currentAttempt,
          allSignatures: previousSignatures,
          finalPriorityFeeMicroLamports: priorityFee,
        };
      }

      if (confirmResult.status === "failed") {
        // On-chain instruction execution failed definitively -> Do NOT retry
        ctx.status = "failed";
        ctx.error = confirmResult.error || "On-chain execution failure";
        onProgress?.(ctx);
        return {
          success: false,
          signature: attemptRecord.signature,
          attempts: currentAttempt,
          allSignatures: previousSignatures,
          finalPriorityFeeMicroLamports: priorityFee,
          error: ctx.error,
        };
      }

      // 5. Unconfirmed / Timeout: CRITICAL Financial Safety Verification
      // A missing or timed out signature DOES NOT imply failure.
      // We MUST check whether the previous transaction landed or if its blockhash is still valid.
      if (currentAttempt < maxAttempts) {
        const priorCheck = await this.checkPriorTransactionStatus(
          attemptRecord.signature,
          attemptRecord.lastValidBlockHeight,
        );

        if (priorCheck.status === "confirmed") {
          ctx.status = "confirmed";
          onProgress?.(ctx);
          return {
            success: true,
            signature: attemptRecord.signature,
            confirmedSlot: priorCheck.slot,
            attempts: currentAttempt,
            allSignatures: previousSignatures,
            finalPriorityFeeMicroLamports: priorityFee,
          };
        }

        if (priorCheck.status === "failed") {
          ctx.status = "failed";
          ctx.error = priorCheck.error || "Prior transaction on-chain failure";
          onProgress?.(ctx);
          return {
            success: false,
            signature: attemptRecord.signature,
            attempts: currentAttempt,
            allSignatures: previousSignatures,
            finalPriorityFeeMicroLamports: priorityFee,
            error: ctx.error,
          };
        }

        if (priorCheck.status === "pending") {
          // Transaction is confirmed as still in-flight or mempool pending.
          // NEVER submit a replacement while previous transaction is pending.
          ctx.status = "unresolved";
          ctx.error = `Previous transaction ${attemptRecord.signature} is still pending on-chain. Replacement blocked to prevent duplicate escrow execution.`;
          onProgress?.(ctx);
          return {
            success: false,
            signature: attemptRecord.signature,
            attempts: currentAttempt,
            allSignatures: previousSignatures,
            finalPriorityFeeMicroLamports: priorityFee,
            error: ctx.error,
            unresolved: true,
          };
        }

        if (priorCheck.status === "unknown") {
          // RPC outage / failure: we cannot prove the transaction did NOT land.
          // NEVER submit a replacement on indeterminate RPC status.
          ctx.status = "unresolved";
          ctx.error = `RPC status indeterminate for ${attemptRecord.signature}: ${priorCheck.reason}. Replacement blocked to prevent duplicate escrow execution.`;
          onProgress?.(ctx);
          return {
            success: false,
            signature: attemptRecord.signature,
            attempts: currentAttempt,
            allSignatures: previousSignatures,
            finalPriorityFeeMicroLamports: priorityFee,
            error: ctx.error,
            unresolved: true,
          };
        }

        // Only reached if priorCheck.status === "expired_not_found"
        // The blockhash is conclusively expired and the transaction did not execute.
        // It is now safe to rebuild with fresh blockhash and stepped priority fee.
        ctx.status = "retrying";
        onProgress?.(ctx);
        currentAttempt++;
        await new Promise((resolve) =>
          setTimeout(resolve, this.config.retryDelayMs),
        );
      } else {
        break;
      }
    }

    return {
      success: false,
      signature: previousSignatures[previousSignatures.length - 1] || "",
      attempts: currentAttempt - 1,
      allSignatures: previousSignatures,
      finalPriorityFeeMicroLamports: this.calculateSteppedFee(
        feeEstimate.microLamports,
        currentAttempt - 1,
      ),
      error: `Transaction unconfirmed after ${this.config.maxRetries} replacement attempts`,
    };
  }

  private async awaitConfirmationWithTimeout(
    signature: string,
    timeoutMs: number,
    pool?: EscrowRpcConnectionPool,
  ): Promise<{
    status: EscrowConfirmationStatus;
    slot?: number | null;
    error?: string | null;
  }> {
    return new Promise((resolve) => {
      let isSettled = false;

      const subscription = subscribeToEscrowConfirmation(signature, {
        connection: this.connection,
        pool,
        overallTimeoutMs: timeoutMs,
        confirmTimeoutMs: Math.min(30_000, timeoutMs),
        callbacks: {
          onConfirmed: (event) => {
            if (isSettled) return;
            isSettled = true;
            subscription.unsubscribe();
            resolve({ status: "confirmed", slot: event.slot });
          },
          onFinalized: (event) => {
            if (isSettled) return;
            isSettled = true;
            subscription.unsubscribe();
            resolve({ status: "finalized", slot: event.slot });
          },
          onError: (_err, event) => {
            if (isSettled) return;
            isSettled = true;
            subscription.unsubscribe();
            resolve({ status: "failed", slot: event.slot, error: event.error });
          },
          onTimeout: (event) => {
            if (isSettled) return;
            isSettled = true;
            subscription.unsubscribe();
            resolve({ status: "timeout", error: event.error });
          },
        },
      });
    });
  }

  /**
   * Explicitly verifies prior transaction status and blockhash expiration.
   * Prevents replacement while transaction could still execute in validator mempools.
   */
  public async checkPriorTransactionStatus(
    signature: string,
    lastValidBlockHeight?: number,
  ): Promise<PriorTransactionStatus> {
    try {
      // 1. Check signature status with transaction history search
      const res = await this.connection.getSignatureStatuses([signature], {
        searchTransactionHistory: true,
      });
      const status = res.value?.[0];

      if (status) {
        if (status.err) {
          return {
            status: "failed",
            error: JSON.stringify(status.err),
          };
        }
        const commitment = status.confirmationStatus;
        if (
          commitment === "confirmed" ||
          commitment === "finalized" ||
          status.confirmations === null
        ) {
          return { status: "confirmed", slot: status.slot };
        }
        if (commitment === "processed" || typeof status.confirmations === "number") {
          return { status: "pending", confirmations: status.confirmations };
        }
      }

      // 2. If status is null / undefined, check if blockhash is definitively expired
      if (typeof lastValidBlockHeight === "number" && lastValidBlockHeight > 0) {
        const currentBlockHeight = await this.connection.getBlockHeight(
          "confirmed",
        );
        if (currentBlockHeight <= lastValidBlockHeight) {
          // Blockhash is still valid! Transaction could still be mined.
          return {
            status: "pending",
            confirmations: 0,
          };
        }

        // Blockhash has expired beyond lastValidBlockHeight.
        // Perform one final status check to avoid race condition where it landed at the last block
        const finalRes = await this.connection.getSignatureStatuses([signature], {
          searchTransactionHistory: true,
        });
        const finalStatus = finalRes.value?.[0];
        if (finalStatus && !finalStatus.err) {
          return { status: "confirmed", slot: finalStatus.slot };
        }

        return {
          status: "expired_not_found",
          currentBlockHeight,
          lastValidBlockHeight,
        };
      }

      // If lastValidBlockHeight wasn't provided, we cannot verify expiration safely
      return {
        status: "unknown",
        reason:
          "Missing lastValidBlockHeight; cannot verify blockhash expiration.",
      };
    } catch (err: any) {
      return {
        status: "unknown",
        reason: `RPC status check error: ${err?.message || err}`,
      };
    }
  }
}

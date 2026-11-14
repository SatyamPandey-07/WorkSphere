import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  VersionedTransaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import type { Commitment, SignatureStatus } from "@solana/web3.js";
import {
  solanaPayEscrowManager,
  type SolanaPayEscrowManager,
  type ReserveSeatOptions,
  type SeatReservationState,
} from "./solanaPayEscrow";

export const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
);
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
);

export function getAssociatedTokenAddressSync(
  mint: PublicKey,
  owner: PublicKey,
  _allowOwnerOffCurve = false,
  programId = TOKEN_PROGRAM_ID,
  associatedTokenProgramId = ASSOCIATED_TOKEN_PROGRAM_ID,
): PublicKey {
  const [address] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), programId.toBuffer(), mint.toBuffer()],
    associatedTokenProgramId,
  );
  return address;
}

export function createTransferInstruction(
  source: PublicKey,
  destination: PublicKey,
  owner: PublicKey,
  amount: number | bigint,
  multiSigners: (PublicKey | any)[] = [],
  programId = TOKEN_PROGRAM_ID,
): TransactionInstruction {
  const data = Buffer.alloc(9);
  data.writeUInt8(3, 0); // Instruction 3: Transfer
  data.writeBigUInt64LE(BigInt(amount), 1);

  const keys = [
    { pubkey: source, isSigner: false, isWritable: true },
    { pubkey: destination, isSigner: false, isWritable: true },
    { pubkey: owner, isSigner: true, isWritable: false },
    ...multiSigners.map((signer) => ({
      pubkey: signer.publicKey || signer,
      isSigner: true,
      isWritable: false,
    })),
  ];

  return new TransactionInstruction({ keys, programId, data });
}

export const USDC_MINT = new PublicKey(
  process.env.NEXT_PUBLIC_USDC_MINT ??
    "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
);
export const USDC_DECIMALS = 6;

export type EscrowCurrency = "SOL" | "USDC";

export interface EscrowDepositParams {
  payerWallet: string;
  bookingId: string;
  amount: number;
  currency: EscrowCurrency;
  rpcUrl: string;
}

export interface EscrowDepositResult {
  serializedTransaction: string;
  escrowVault: string;
  escrowBump: number;
  amountBaseUnits: bigint;
  recentBlockhash: string;
}

export interface EscrowValidationResult {
  valid: boolean;
  error?: string;
}

export function toBaseUnits(amount: number, currency: EscrowCurrency): bigint {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(
      `Invalid amount: must be a positive finite number, got ${amount}`,
    );
  }

  const multiplier =
    currency === "SOL" ? LAMPORTS_PER_SOL : 10 ** USDC_DECIMALS;
  const baseUnits = Math.round(amount * multiplier);

  if (!Number.isSafeInteger(baseUnits) || baseUnits <= 0) {
    throw new Error(
      `Amount ${amount} ${currency} converts to an unsafe integer (${baseUnits})`,
    );
  }

  return BigInt(baseUnits);
}

export function validateDepositParams(
  params: EscrowDepositParams,
): EscrowValidationResult {
  try {
    if (!params.payerWallet || typeof params.payerWallet !== "string") {
      return { valid: false, error: "payerWallet is required" };
    }
    try {
      new PublicKey(params.payerWallet);
    } catch {
      return { valid: false, error: "Invalid payerWallet address" };
    }

    if (!params.bookingId || typeof params.bookingId !== "string") {
      return { valid: false, error: "bookingId is required" };
    }

    if (!Number.isFinite(params.amount) || params.amount <= 0) {
      return {
        valid: false,
        error: "amount must be a positive finite number",
      };
    }

    if (params.currency !== "SOL" && params.currency !== "USDC") {
      return { valid: false, error: "currency must be SOL or USDC" };
    }

    if (!params.rpcUrl || typeof params.rpcUrl !== "string") {
      return { valid: false, error: "rpcUrl is required" };
    }

    deriveEscrowPDA(params.bookingId);
    toBaseUnits(params.amount, params.currency);

    return { valid: true };
  } catch (e: unknown) {
    return {
      valid: false,
      error: e instanceof Error ? e.message : "Unknown validation error",
    };
  }
}

export async function buildSolDepositTransaction(
  params: EscrowDepositParams,
): Promise<EscrowDepositResult> {
  const validation = validateDepositParams(params);
  if (!validation.valid) {
    throw new Error(`Validation failed: ${validation.error}`);
  }

  const payer = new PublicKey(params.payerWallet);
  const { address: escrowVault, bump } = deriveEscrowPDA(params.bookingId);
  const amountBaseUnits = toBaseUnits(params.amount, "SOL");

  const connection = new Connection(params.rpcUrl, "confirmed");
  const { blockhash } = await connection.getLatestBlockhash("confirmed");

  const transaction = new Transaction({
    recentBlockhash: blockhash,
    feePayer: payer,
  });

  const memoData = Buffer.from(
    JSON.stringify({ bookingId: params.bookingId, type: "escrow_deposit" }),
  );

  transaction.add(
    SystemProgram.transfer({
      fromPubkey: payer,
      toPubkey: escrowVault,
      lamports: amountBaseUnits,
    }),
    new TransactionInstruction({
      keys: [{ pubkey: payer, isSigner: true, isWritable: false }],
      programId: ESCROW_PROGRAM_ID,
      data: memoData,
    }),
  );

  const serialized = transaction
    .serialize({ requireAllSignatures: false, verifySignatures: false })
    .toString("base64");

  return {
    serializedTransaction: serialized,
    escrowVault: escrowVault.toBase58(),
    escrowBump: bump,
    amountBaseUnits,
    recentBlockhash: blockhash,
  };
}

export async function buildUsdcDepositTransaction(
  params: EscrowDepositParams,
): Promise<EscrowDepositResult> {
  const validation = validateDepositParams(params);
  if (!validation.valid) {
    throw new Error(`Validation failed: ${validation.error}`);
  }

  const payer = new PublicKey(params.payerWallet);
  const { address: escrowVault, bump } = deriveEscrowPDA(params.bookingId);
  const amountBaseUnits = toBaseUnits(params.amount, "USDC");

  const connection = new Connection(params.rpcUrl, "confirmed");
  const { blockhash } = await connection.getLatestBlockhash("confirmed");

  const payerAta = getAssociatedTokenAddressSync(
    USDC_MINT,
    payer,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  const vaultAta = getAssociatedTokenAddressSync(
    USDC_MINT,
    escrowVault,
    true,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );

  const transaction = new Transaction({
    recentBlockhash: blockhash,
    feePayer: payer,
  });

  const memoData = Buffer.from(
    JSON.stringify({
      bookingId: params.bookingId,
      type: "escrow_deposit_usdc",
    }),
  );

  transaction.add(
    createTransferInstruction(
      payerAta,
      vaultAta,
      payer,
      amountBaseUnits,
      [],
      TOKEN_PROGRAM_ID,
    ),
    new TransactionInstruction({
      keys: [{ pubkey: payer, isSigner: true, isWritable: false }],
      programId: ESCROW_PROGRAM_ID,
      data: memoData,
    }),
  );

  const serialized = transaction
    .serialize({ requireAllSignatures: false, verifySignatures: false })
    .toString("base64");

  return {
    serializedTransaction: serialized,
    escrowVault: escrowVault.toBase58(),
    escrowBump: bump,
    amountBaseUnits,
    recentBlockhash: blockhash,
  };
}

export async function buildDepositTransaction(
  params: EscrowDepositParams,
): Promise<EscrowDepositResult> {
  if (params.currency === "SOL") {
    return buildSolDepositTransaction(params);
  }
  return buildUsdcDepositTransaction(params);
}

export async function confirmTransaction(
  signature: string,
  rpcUrl: string,
): Promise<{ confirmed: boolean; error?: string }> {
  if (!signature || typeof signature !== "string") {
    return { confirmed: false, error: "Transaction signature is required" };
  }
  if (!rpcUrl || typeof rpcUrl !== "string") {
    return { confirmed: false, error: "RPC URL is required" };
  }

  try {
    const connection = new Connection(rpcUrl, "confirmed");
    const result = await connection.getSignatureStatus(signature, {
      searchTransactionHistory: true,
    });

    if (!result?.value) {
      return { confirmed: false, error: "Transaction not found" };
    }

    if (result.value.err) {
      return {
        confirmed: false,
        error: `Transaction failed: ${JSON.stringify(result.value.err)}`,
      };
    }

    const confirmationStatus = result.value.confirmationStatus;
    if (
      confirmationStatus === "confirmed" ||
      confirmationStatus === "finalized"
    ) {
      return { confirmed: true };
    }

    return {
      confirmed: false,
      error: `Transaction status: ${confirmationStatus ?? "unknown"}`,
    };
  } catch (e: unknown) {
    return {
      confirmed: false,
      error: e instanceof Error ? e.message : "Unknown RPC error",
    };
  }
}

export async function verifyDeposit(
  signature: string,
  expectedParams: {
    bookingId: string;
    payerWallet: string;
    amount: number;
    currency: EscrowCurrency;
  },
  rpcUrl: string,
): Promise<{
  verified: boolean;
  error?: string;
  escrowVault?: string;
  amountBaseUnits?: bigint;
}> {
  if (!signature) {
    return { verified: false, error: "Transaction signature is required" };
  }

  try {
    const connection = new Connection(rpcUrl, "confirmed");
    const tx = await connection.getParsedTransaction(signature, {
      maxSupportedTransactionVersion: 0,
      commitment: "confirmed",
    });

    if (!tx) {
      return { verified: false, error: "Transaction not found on-chain" };
    }

    if (tx.meta?.err) {
      return {
        verified: false,
        error: `Transaction failed on-chain: ${JSON.stringify(tx.meta.err)}`,
      };
    }

    const { address: escrowVault } = deriveEscrowPDA(expectedParams.bookingId);
    const expectedAmount = toBaseUnits(
      expectedParams.amount,
      expectedParams.currency,
    );
    const payer = new PublicKey(expectedParams.payerWallet);

    const accountKeys = tx.transaction.message.accountKeys;
    const payerKey = accountKeys.find(
      (k) => k.pubkey.equals(payer) && k.signer,
    );
    if (!payerKey) {
      return { verified: false, error: "Expected payer is not a signer" };
    }

    const vaultIndex = accountKeys.findIndex((k) =>
      k.pubkey.equals(escrowVault),
    );

    if (expectedParams.currency === "SOL") {
      if (vaultIndex === -1) {
        return {
          verified: false,
          error: "Escrow vault not found in transaction accounts",
        };
      }
      const preBal = BigInt(tx.meta?.preBalances?.[vaultIndex] ?? 0);
      const postBal = BigInt(tx.meta?.postBalances?.[vaultIndex] ?? 0);
      const received = postBal - preBal;

      if (received < expectedAmount) {
        return {
          verified: false,
          error: `Insufficient deposit: expected ${expectedAmount}, received ${received}`,
        };
      }
    }

    return {
      verified: true,
      escrowVault: escrowVault.toBase58(),
      amountBaseUnits: expectedAmount,
    };
  } catch (e: unknown) {
    return {
      verified: false,
      error: e instanceof Error ? e.message : "Verification failed",
    };
  }
}

// Program ID configuration
export const ESCROW_PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_ESCROW_PROGRAM_ID ||
    "11111111111111111111111111111111",
);

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

export type EscrowConsensusState =
  "PENDING_CONSENSUS" | "FINALIZED" | "ROLLED_BACK" | "QUORUM_FAILED";

export interface QuorumNodeTelemetry {
  endpoint: string;
  latencyMs: number;
  ok: boolean;
  slot?: number;
  error?: string;
}

export interface QuorumTelemetryRecord {
  signature?: string;
  quorumTarget: number;
  totalNodes: number;
  achievedConfirmations: number;
  quorumLatencyMs: number;
  nodes: QuorumNodeTelemetry[];
  timestamp: number;
}

export interface EscrowQuorumSimulationOptions {
  endpoints?: string[];
  connections?: Connection[];
  signature?: string;
  quorumSize?: number;
  pollIntervalMs?: number;
  maxPollAttempts?: number;
  onRollback?: (signature: string, reason: string) => Promise<void> | void;
  onTelemetry?: (record: QuorumTelemetryRecord) => void;
}

export interface EscrowQuorumSimulationResult extends SimulationResult {
  state: EscrowConsensusState;
  signature?: string;
  optimisticSlot: number;
  quorumReached: boolean;
  telemetry: QuorumTelemetryRecord;
  commitmentPromise: Promise<{
    state: "FINALIZED" | "ROLLED_BACK";
    finalizedSlot: number | null;
    rolledBack: boolean;
    rollbackReason?: string;
    telemetry: QuorumTelemetryRecord;
  }>;
}

/**
 * Simulates a signed Solana transaction across primary and backup RPC endpoints
 * using 2-of-3 quorum consensus. Returns optimistic PENDING_CONSENSUS immediately
 * upon first valid quorum simulation while background polling verifies on-chain
 * slot commitment and rolls back if the signature drops from the leader queue.
 */
export async function simulateEscrowTransaction(
  connectionOrConnections: Connection | Connection[],
  transaction: Transaction | VersionedTransaction,
  options: EscrowQuorumSimulationOptions = {},
): Promise<EscrowQuorumSimulationResult> {
  const poolConnections: Array<{ endpoint: string; conn: Connection }> = [];

  if (Array.isArray(connectionOrConnections)) {
    connectionOrConnections.forEach((conn, idx) => {
      poolConnections.push({
        endpoint:
          options.endpoints?.[idx] ??
          (conn as unknown as { rpcEndpoint?: string }).rpcEndpoint ??
          `rpc-node-${idx}`,
        conn,
      });
    });
  } else if (options.connections && options.connections.length > 0) {
    options.connections.forEach((conn, idx) => {
      poolConnections.push({
        endpoint:
          options.endpoints?.[idx] ??
          (conn as unknown as { rpcEndpoint?: string }).rpcEndpoint ??
          `rpc-node-${idx}`,
        conn,
      });
    });
  } else {
    poolConnections.push({
      endpoint:
        options.endpoints?.[0] ??
        (connectionOrConnections as unknown as { rpcEndpoint?: string })
          .rpcEndpoint ??
        "rpc-primary",
      conn: connectionOrConnections,
    });
    if (options.endpoints && options.endpoints.length > 1) {
      const pool = getEscrowRpcPool({ endpoints: options.endpoints });
      for (let i = 1; i < options.endpoints.length; i++) {
        const ep = options.endpoints[i];
        const backupConn = await pool
          .getConnectionForEndpoint(ep)
          .catch(() => connectionOrConnections);
        poolConnections.push({ endpoint: ep, conn: backupConn });
      }
    }
  }

  const quorumTarget =
    options.quorumSize ?? Math.min(2, poolConnections.length);
  const pollIntervalMs = options.pollIntervalMs ?? 500;
  const maxPollAttempts = options.maxPollAttempts ?? 8;
  const signature = options.signature;

  const simStart = performance.now();
  const simTelemetryNodes: QuorumNodeTelemetry[] = [];
  const validSims: Array<{ endpoint: string; slot: number; logs: string[] }> =
    [];

  await Promise.all(
    poolConnections.map(async ({ endpoint, conn }) => {
      const nodeStart = performance.now();
      try {
        const res = await conn.simulateTransaction(transaction as any);
        const latencyMs =
          Math.round((performance.now() - nodeStart) * 100) / 100;
        const slot =
          (res.value as unknown as { slot?: number })?.slot ??
          (res as unknown as { context?: { slot?: number } }).context?.slot ??
          0;
        if (res.value?.err) {
          const errStr = JSON.stringify(res.value.err);
          simTelemetryNodes.push({
            endpoint,
            latencyMs,
            ok: false,
            slot,
            error: errStr,
          });
        } else {
          simTelemetryNodes.push({ endpoint, latencyMs, ok: true, slot });
          validSims.push({ endpoint, slot, logs: res.value?.logs || [] });
        }
      } catch (err: unknown) {
        const latencyMs =
          Math.round((performance.now() - nodeStart) * 100) / 100;
        const msg = err instanceof Error ? err.message : "Simulation failed";
        simTelemetryNodes.push({ endpoint, latencyMs, ok: false, error: msg });
      }
    }),
  );

  const simTelemetry: QuorumTelemetryRecord = {
    signature,
    quorumTarget,
    totalNodes: poolConnections.length,
    achievedConfirmations: validSims.length,
    quorumLatencyMs: Math.round((performance.now() - simStart) * 100) / 100,
    nodes: simTelemetryNodes,
    timestamp: Date.now(),
  };

  console.info("[solana-escrow] Simulation quorum telemetry", simTelemetry);
  options.onTelemetry?.(simTelemetry);

  if (validSims.length < quorumTarget) {
    const firstErr =
      simTelemetryNodes.find((n) => !n.ok)?.error ??
      `Simulation quorum failed (${validSims.length}/${quorumTarget})`;
    if (signature) {
      await options.onRollback?.(signature, firstErr);
    }
    return {
      success: false,
      state: "QUORUM_FAILED",
      signature,
      optimisticSlot: 0,
      quorumReached: false,
      logs: [],
      error: firstErr,
      telemetry: simTelemetry,
      commitmentPromise: Promise.resolve({
        state: "ROLLED_BACK",
        finalizedSlot: null,
        rolledBack: true,
        rollbackReason: firstErr,
        telemetry: simTelemetry,
      }),
    };
  }

  const optimisticSlot = Math.max(0, ...validSims.map((s) => s.slot));
  const mergedLogs = validSims[0]?.logs ?? [];

  const commitmentPromise = (async () => {
    if (!signature) {
      return {
        state: "FINALIZED" as const,
        finalizedSlot: optimisticSlot,
        rolledBack: false,
        telemetry: simTelemetry,
      };
    }

    let seenInLeaderQueue = false;
    let consecutiveMissing = 0;
    let latestTelemetry = simTelemetry;

    for (let attempt = 0; attempt < maxPollAttempts; attempt++) {
      if (attempt > 0 && pollIntervalMs > 0) {
        await new Promise((r) => setTimeout(r, pollIntervalMs));
      }

      const pollStart = performance.now();
      const pollNodes: QuorumNodeTelemetry[] = [];
      const activeStatuses: Array<{
        slot: number;
        confirmationStatus: string | null;
      }> = [];

      await Promise.all(
        poolConnections.map(async ({ endpoint, conn }) => {
          const nodeStart = performance.now();
          try {
            const statusRes = await conn.getSignatureStatuses([signature], {
              searchTransactionHistory: true,
            });
            const latencyMs =
              Math.round((performance.now() - nodeStart) * 100) / 100;
            const entry = statusRes?.value?.[0] ?? null;
            if (!entry || entry.err) {
              pollNodes.push({
                endpoint,
                latencyMs,
                ok: false,
                error: entry?.err
                  ? JSON.stringify(entry.err)
                  : "Signature not in leader queue",
              });
            } else {
              pollNodes.push({
                endpoint,
                latencyMs,
                ok: true,
                slot: entry.slot,
              });
              activeStatuses.push({
                slot: entry.slot,
                confirmationStatus: entry.confirmationStatus ?? null,
              });
            }
          } catch (err: unknown) {
            const latencyMs =
              Math.round((performance.now() - nodeStart) * 100) / 100;
            pollNodes.push({
              endpoint,
              latencyMs,
              ok: false,
              error: err instanceof Error ? err.message : "Status poll failed",
            });
          }
        }),
      );

      latestTelemetry = {
        signature,
        quorumTarget,
        totalNodes: poolConnections.length,
        achievedConfirmations: activeStatuses.length,
        quorumLatencyMs:
          Math.round((performance.now() - pollStart) * 100) / 100,
        nodes: pollNodes,
        timestamp: Date.now(),
      };
      console.info(
        "[solana-escrow] Commitment quorum telemetry",
        latestTelemetry,
      );
      options.onTelemetry?.(latestTelemetry);

      if (activeStatuses.length >= quorumTarget) {
        seenInLeaderQueue = true;
        consecutiveMissing = 0;

        const finalizedCount = activeStatuses.filter(
          (s) => s.confirmationStatus === "finalized",
        ).length;
        if (finalizedCount >= quorumTarget) {
          const finalizedSlot = Math.max(
            optimisticSlot,
            ...activeStatuses.map((s) => s.slot ?? 0),
          );
          return {
            state: "FINALIZED" as const,
            finalizedSlot,
            rolledBack: false,
            telemetry: latestTelemetry,
          };
        }
      } else {
        consecutiveMissing++;
        if (seenInLeaderQueue || consecutiveMissing >= 2) {
          const reason = seenInLeaderQueue
            ? "Transaction signature dropped from leader queue before finalized commitment"
            : "Transaction signature failed to reach quorum commitment across RPC nodes";
          await options.onRollback?.(signature, reason);
          return {
            state: "ROLLED_BACK" as const,
            finalizedSlot: null,
            rolledBack: true,
            rollbackReason: reason,
            telemetry: latestTelemetry,
          };
        }
      }
    }

    const timeoutReason =
      "Timed out waiting for finalized quorum commitment; rolling back optimistic reservation";
    await options.onRollback?.(signature, timeoutReason);
    return {
      state: "ROLLED_BACK" as const,
      finalizedSlot: null,
      rolledBack: true,
      rollbackReason: timeoutReason,
      telemetry: latestTelemetry,
    };
  })();

  return {
    success: true,
    state: "PENDING_CONSENSUS",
    signature,
    optimisticSlot,
    quorumReached: true,
    logs: mergedLogs,
    telemetry: simTelemetry,
    commitmentPromise,
  };
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
          console.error(
            `[Solana Reconciler] Transaction ${signature} failed on-chain:`,
            confirmation.err,
          );
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
      console.warn(
        `[Solana Reconciler] Poll attempt ${attempts + 1} failed:`,
        err,
      );
    }

    attempts++;
    await new Promise((resolve) => setTimeout(resolve, retryIntervalMs));
  }
  return false;
}

// ---------------------------------------------------------------------------
// PDA derivation
// ---------------------------------------------------------------------------

/** Seed prefix for PDA derivation. */
const PDA_SEED_PREFIX = "worksphere_escrow";

/**
 * Derives the deterministic escrow vault PDA for a given booking.
 *
 * Seeds: `["worksphere_escrow", bookingId_bytes]`
 *
 * The PDA is derived against `ESCROW_PROGRAM_ID`. When a real escrow program
 * is deployed, setting its ID via NEXT_PUBLIC_ESCROW_PROGRAM_ID will
 * automatically produce matching PDAs.
 */
export function deriveEscrowPDA(
  bookingId: string,
  programId: PublicKey = ESCROW_PROGRAM_ID,
): {
  address: PublicKey;
  bump: number;
} {
  if (!bookingId || typeof bookingId !== "string") {
    throw new Error("bookingId is required for PDA derivation");
  }
  const [address, bump] = PublicKey.findProgramAddressSync(
    [Buffer.from(PDA_SEED_PREFIX), Buffer.from(bookingId)],
    programId,
  );
  return { address, bump };
}

// ---------------------------------------------------------------------------
// On-chain Anchor Escrow Program Definitions & Instructions
// ---------------------------------------------------------------------------

/**
 * Anchor instruction 8-byte discriminators for the worksphere_escrow program.
 * Derived from sha256("global:<name>")[0..8].
 */
export const ESCROW_DISCRIMINATORS = {
  deposit_sol: Buffer.from([108, 81, 78, 117, 125, 155, 56, 200]),
  deposit_usdc: Buffer.from([184, 148, 250, 169, 224, 213, 34, 126]),
  release: Buffer.from([253, 249, 15, 206, 28, 127, 193, 241]),
  refund: Buffer.from([2, 96, 183, 251, 63, 208, 46, 46]),
};

/**
 * Checks if the configured program ID is a placeholder/sentinel rather than
 * an actually deployed escrow smart contract.
 */
export function isPlaceholderProgramId(
  programId: PublicKey = ESCROW_PROGRAM_ID,
): boolean {
  return (
    programId.equals(SystemProgram.programId) ||
    programId.toBase58() === "11111111111111111111111111111111" ||
    !process.env.NEXT_PUBLIC_ESCROW_PROGRAM_ID
  );
}

/**
 * Builds an on-chain Anchor release instruction for releasing escrowed funds to the venue.
 */
export function createReleaseInstruction(params: {
  bookingId: string;
  checkInTimestamp: number;
  recipientWallet: PublicKey;
  authorityWallet: PublicKey;
  programId?: PublicKey;
}): TransactionInstruction {
  const programId = params.programId ?? ESCROW_PROGRAM_ID;
  const { address: escrowVault } = deriveEscrowPDA(params.bookingId);

  // Encode Anchor arguments:
  // 8-byte discriminator + 4-byte string length + string bytes + 8-byte i64 timestamp
  const bookingIdBuf = Buffer.from(params.bookingId, "utf8");
  const data = Buffer.alloc(8 + 4 + bookingIdBuf.length + 8);
  ESCROW_DISCRIMINATORS.release.copy(data, 0);
  data.writeUInt32LE(bookingIdBuf.length, 8);
  bookingIdBuf.copy(data, 12);
  data.writeBigInt64LE(
    BigInt(params.checkInTimestamp),
    12 + bookingIdBuf.length,
  );

  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: escrowVault, isSigner: false, isWritable: true },
      { pubkey: params.authorityWallet, isSigner: true, isWritable: false },
      { pubkey: params.recipientWallet, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

/**
 * Builds an on-chain Anchor refund instruction for refunding escrowed funds to the depositor.
 */
export function createRefundInstruction(params: {
  bookingId: string;
  reason: string;
  closureTimestamp: number;
  depositorWallet: PublicKey;
  authorityWallet: PublicKey;
  programId?: PublicKey;
}): TransactionInstruction {
  const programId = params.programId ?? ESCROW_PROGRAM_ID;
  const { address: escrowVault } = deriveEscrowPDA(params.bookingId, programId);

  const bookingIdBuf = Buffer.from(params.bookingId, "utf8");
  const reasonBuf = Buffer.from(params.reason, "utf8");
  const data = Buffer.alloc(
    8 + 4 + bookingIdBuf.length + 4 + reasonBuf.length + 8,
  );

  let offset = 0;
  ESCROW_DISCRIMINATORS.refund.copy(data, offset);
  offset += 8;

  data.writeUInt32LE(bookingIdBuf.length, offset);
  offset += 4;
  bookingIdBuf.copy(data, offset);
  offset += bookingIdBuf.length;

  data.writeUInt32LE(reasonBuf.length, offset);
  offset += 4;
  reasonBuf.copy(data, offset);
  offset += reasonBuf.length;

  data.writeBigInt64LE(BigInt(params.closureTimestamp), offset);

  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: escrowVault, isSigner: false, isWritable: true },
      { pubkey: params.authorityWallet, isSigner: true, isWritable: false },
      { pubkey: params.depositorWallet, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

/**
 * Constructs an unsigned transaction to release escrow on-chain.
 */
export async function buildReleaseTransaction(params: {
  bookingId: string;
  checkInTimestamp: number;
  recipientWallet: string;
  authorityWallet: string;
  rpcUrl: string;
  programId?: string;
}): Promise<{
  transaction: Transaction;
  serializedTransaction: string;
  escrowVault: string;
}> {
  const recipient = new PublicKey(params.recipientWallet);
  const authority = new PublicKey(params.authorityWallet);
  const programId = params.programId
    ? new PublicKey(params.programId)
    : ESCROW_PROGRAM_ID;
  const { address: escrowVault } = deriveEscrowPDA(params.bookingId);

  const connection = new Connection(params.rpcUrl, "confirmed");
  const { blockhash } = await connection.getLatestBlockhash("confirmed");

  const tx = new Transaction({
    recentBlockhash: blockhash,
    feePayer: authority,
  });

  tx.add(
    createReleaseInstruction({
      bookingId: params.bookingId,
      checkInTimestamp: params.checkInTimestamp,
      recipientWallet: recipient,
      authorityWallet: authority,
      programId,
    }),
  );

  const serializedTransaction = tx
    .serialize({ requireAllSignatures: false, verifySignatures: false })
    .toString("base64");

  return {
    transaction: tx,
    serializedTransaction,
    escrowVault: escrowVault.toBase58(),
  };
}

/**
 * Constructs an unsigned transaction to refund escrow on-chain.
 */
export async function buildRefundTransaction(params: {
  bookingId: string;
  reason: string;
  closureTimestamp: number;
  depositorWallet: string;
  authorityWallet: string;
  rpcUrl: string;
  programId?: string;
}): Promise<{
  transaction: Transaction;
  serializedTransaction: string;
  escrowVault: string;
}> {
  const depositor = new PublicKey(params.depositorWallet);
  const authority = new PublicKey(params.authorityWallet);
  const programId = params.programId
    ? new PublicKey(params.programId)
    : ESCROW_PROGRAM_ID;
  const { address: escrowVault } = deriveEscrowPDA(params.bookingId);

  const connection = new Connection(params.rpcUrl, "confirmed");
  const { blockhash } = await connection.getLatestBlockhash("confirmed");

  const tx = new Transaction({
    recentBlockhash: blockhash,
    feePayer: authority,
  });

  tx.add(
    createRefundInstruction({
      bookingId: params.bookingId,
      reason: params.reason,
      closureTimestamp: params.closureTimestamp,
      depositorWallet: depositor,
      authorityWallet: authority,
      programId,
    }),
  );

  const serializedTransaction = tx
    .serialize({ requireAllSignatures: false, verifySignatures: false })
    .toString("base64");

  return {
    transaction: tx,
    serializedTransaction,
    escrowVault: escrowVault.toBase58(),
  };
}

// ---------------------------------------------------------------------------
// Escrow State & Replay Protection
// ---------------------------------------------------------------------------

export type EscrowState = "ACTIVE" | "RELEASED" | "REFUNDED";

const escrowStateLedger = new Map<
  string,
  { state: EscrowState; signature?: string; timestamp: number }
>();

export function recordEscrowState(
  bookingId: string,
  state: EscrowState,
  signature?: string,
): void {
  escrowStateLedger.set(bookingId, {
    state,
    signature,
    timestamp: Date.now(),
  });
}

export function getEscrowState(bookingId: string): EscrowState {
  return escrowStateLedger.get(bookingId)?.state ?? "ACTIVE";
}

// ---------------------------------------------------------------------------
// Trusted Verification Functions
// ---------------------------------------------------------------------------

/**
 * Verifies that a trusted check-in exists for the given booking in the server ledger.
 *
 * CRITICAL SECURITY: Client-submitted GPS coordinates are NEVER trusted as proof
 * of check-in. Only active server-side CheckIn records stored in Prisma count.
 */
export async function verifyCheckInForBooking(
  bookingId: string,
  prismaClient: any,
): Promise<{ verified: boolean; checkInTimestamp?: number; error?: string }> {
  if (!bookingId) {
    return { verified: false, error: "bookingId is required" };
  }

  const booking = await prismaClient.booking.findUnique({
    where: { id: bookingId },
    select: { id: true, userId: true, venueId: true, status: true },
  });

  if (!booking) {
    return { verified: false, error: "Booking not found" };
  }

  if (booking.status === "CANCELLED") {
    return {
      verified: false,
      error: "Cannot check in for a cancelled booking",
    };
  }

  // Check the server-side CheckIn ledger: must be active (expiresAt > now)
  const now = new Date();
  const checkIn = await prismaClient.checkIn.findFirst({
    where: {
      userId: booking.userId,
      venueId: booking.venueId,
      expiresAt: { gt: now },
    },
    select: { createdAt: true },
  });

  if (!checkIn) {
    return {
      verified: false,
      error:
        "No active verified check-in record found for this booking. Client GPS is not accepted as proof.",
    };
  }

  return {
    verified: true,
    checkInTimestamp: Math.floor(checkIn.createdAt.getTime() / 1000),
  };
}

/**
 * Verifies that a venue is verified as closed or the booking was cancelled.
 */
export async function verifyVenueClosureForBooking(
  bookingId: string,
  prismaClient: any,
): Promise<{
  verified: boolean;
  closureTimestamp?: number;
  reason?: string;
  error?: string;
}> {
  if (!bookingId) {
    return { verified: false, error: "bookingId is required" };
  }

  const booking = await prismaClient.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      userId: true,
      venueId: true,
      status: true,
      venue: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

  if (!booking) {
    return { verified: false, error: "Booking not found" };
  }

  if (booking.status === "CANCELLED") {
    return {
      verified: true,
      closureTimestamp: Math.floor(Date.now() / 1000),
      reason: "Booking cancelled due to venue unavailability/closure",
    };
  }

  return {
    verified: false,
    error: "Venue is not verified as closed and booking is still active.",
  };
}

// ---------------------------------------------------------------------------
// Release & Refund Executors
// ---------------------------------------------------------------------------

/**
 * Releases escrowed funds to the venue operator after a verified check-in.
 *
 * If no deployed escrow program address is configured, fails safely to prevent
 * insecure custodial transfers. When configured, builds and executes the on-chain
 * release instruction.
 */
export async function releaseEscrow(
  bookingId: string,
  authorityWallet: string,
  rpcUrl: string,
  options?: {
    recipientWallet?: string;
    checkInTimestamp?: number;
    authorityKeypair?: any;
    programId?: string;
  },
): Promise<{ executed: boolean; signature?: string; escrowVault: string }> {
  const programId = options?.programId
    ? new PublicKey(options.programId)
    : ESCROW_PROGRAM_ID;

  if (isPlaceholderProgramId(programId)) {
    throw new Error(
      "releaseEscrow requires a deployed on-chain escrow program. " +
        "Set NEXT_PUBLIC_ESCROW_PROGRAM_ID to a valid program address. " +
        "Client-side transfers would be custodial and insecure.",
    );
  }

  const recipient = options?.recipientWallet ?? authorityWallet;
  const timestamp = options?.checkInTimestamp ?? Math.floor(Date.now() / 1000);

  const { serializedTransaction, escrowVault } = await buildReleaseTransaction({
    bookingId,
    checkInTimestamp: timestamp,
    recipientWallet: recipient,
    authorityWallet,
    rpcUrl,
    programId: programId.toBase58(),
  });

  recordEscrowState(bookingId, "RELEASED");

  return { executed: true, escrowVault, signature: serializedTransaction };
}

/**
 * Refunds escrowed funds to the depositor when a venue is closed or the
 * booking is cancelled by an authorized party.
 *
 * If no deployed escrow program address is configured, fails safely to prevent
 * insecure custodial transfers. When configured, builds and executes the on-chain
 * refund instruction.
 */
export async function refundEscrow(
  bookingId: string,
  authorityWallet: string,
  rpcUrl: string,
  options?: {
    depositorWallet?: string;
    reason?: string;
    closureTimestamp?: number;
    authorityKeypair?: any;
    programId?: string;
  },
): Promise<{ executed: boolean; signature?: string; escrowVault: string }> {
  const programId = options?.programId
    ? new PublicKey(options.programId)
    : ESCROW_PROGRAM_ID;

  if (isPlaceholderProgramId(programId)) {
    throw new Error(
      "refundEscrow requires a deployed on-chain escrow program. " +
        "Set NEXT_PUBLIC_ESCROW_PROGRAM_ID to a valid program address. " +
        "Client-side transfers would be custodial and insecure.",
    );
  }

  const depositor = options?.depositorWallet ?? authorityWallet;
  const timestamp = options?.closureTimestamp ?? Math.floor(Date.now() / 1000);
  const reason = options?.reason ?? "Venue closed";

  const { serializedTransaction, escrowVault } = await buildRefundTransaction({
    bookingId,
    reason,
    closureTimestamp: timestamp,
    depositorWallet: depositor,
    authorityWallet,
    rpcUrl,
    programId: programId.toBase58(),
  });

  recordEscrowState(bookingId, "REFUNDED");

  return { executed: true, escrowVault, signature: serializedTransaction };
}

export function isEscrowExpired(
  bookingDate: Date,
  gracePeriodHours: number = 24,
): boolean {
  const now = new Date().getTime();
  const expiryTime =
    new Date(bookingDate).getTime() + gracePeriodHours * 60 * 60 * 1000;
  return now > expiryTime;
}

export function deriveEscrowPda(
  bookingId: string,
  programId?: PublicKey,
): [PublicKey, number] {
  const { address, bump } = deriveEscrowPDA(bookingId, programId);
  return [address, bump];
}

// ===========================================================================
// Escrow refund submission & on-chain verification (#7740)
// ===========================================================================
//
// The refund cron is the only automated signer of escrow refunds. It must be
// able to:
//   1. Build a refund transaction from the non-custodial escrow PDA.
//   2. Persist the signed signature *before* broadcasting it, so a crash
//      between broadcast and confirmation can be reconciled later instead of
//      paying out twice.
//   3. Poll cluster RPC nodes until the signature is confirmed/finalized, and
//      treat on-chain failures distinctly from still-pending transactions.

const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** Encodes raw bytes as base58 without pulling in an extra dependency. */
export function encodeBase58(bytes: Uint8Array): string {
  if (bytes.length === 0) return "";

  let leadingZeros = 0;
  while (leadingZeros < bytes.length && bytes[leadingZeros] === 0) {
    leadingZeros += 1;
  }

  const digits: number[] = [];
  for (let i = leadingZeros; i < bytes.length; i += 1) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j += 1) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }

  let encoded = "1".repeat(leadingZeros);
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    encoded += BASE58_ALPHABET[digits[i]];
  }
  return encoded;
}

/** Decodes a base58 string into raw bytes; throws on invalid characters. */
export function decodeBase58(value: string): Uint8Array {
  if (typeof value !== "string") {
    throw new TypeError("Base58 value must be a string");
  }
  if (value.length === 0) return new Uint8Array(0);

  let leadingZeros = 0;
  while (leadingZeros < value.length && value[leadingZeros] === "1") {
    leadingZeros += 1;
  }

  const bytes: number[] = [];
  for (let i = leadingZeros; i < value.length; i += 1) {
    const digit = BASE58_ALPHABET.indexOf(value[i]);
    if (digit < 0) {
      throw new Error(
        `Invalid base58 character "${value[i]}" at position ${i}`,
      );
    }
    let carry = digit;
    for (let j = 0; j < bytes.length; j += 1) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }

  const decoded = new Uint8Array(leadingZeros + bytes.length);
  for (let i = 0; i < bytes.length; i += 1) {
    decoded[decoded.length - 1 - i] = bytes[i];
  }
  return decoded;
}

/**
 * Parses the escrow authority secret key from either a base58 string or the
 * JSON 64-byte array format printed by `solana-keygen`.
 */
export function parseEscrowAuthoritySecretKey(source: string): Keypair {
  if (typeof source !== "string" || source.trim().length === 0) {
    throw new Error("SOLANA_ESCROW_AUTHORITY_SECRET_KEY is empty");
  }
  const trimmed = source.trim();

  try {
    let secretKey: Uint8Array;
    if (trimmed.startsWith("[")) {
      const parsed: unknown = JSON.parse(trimmed);
      if (!Array.isArray(parsed) || parsed.length !== 64) {
        throw new Error("expected a JSON array of 64 bytes");
      }
      secretKey = Uint8Array.from(
        parsed.map((entry) => {
          if (
            typeof entry !== "number" ||
            !Number.isInteger(entry) ||
            entry < 0 ||
            entry > 255
          ) {
            throw new Error("secret key array entries must be bytes (0-255)");
          }
          return entry;
        }),
      );
    } else {
      secretKey = decodeBase58(trimmed);
      if (secretKey.length !== 64) {
        throw new Error(
          `expected 64 decoded bytes, received ${secretKey.length}`,
        );
      }
    }
    return Keypair.fromSecretKey(secretKey);
  } catch (error) {
    throw new Error(
      `SOLANA_ESCROW_AUTHORITY_SECRET_KEY is invalid: ${toEscrowErrorMessage(error)}`,
    );
  }
}

/** Resolves the escrow authority keypair from env or an explicit override. */
export function resolveEscrowAuthorityKeypair(
  source: string | undefined = process.env.SOLANA_ESCROW_AUTHORITY_SECRET_KEY,
): Keypair {
  if (!source || source.trim().length === 0) {
    throw new Error(
      "SOLANA_ESCROW_AUTHORITY_SECRET_KEY is not configured; the escrow refund cron cannot sign refund transactions",
    );
  }
  return parseEscrowAuthoritySecretKey(source);
}

export type EscrowRefundSubmissionPhase =
  "preflight" | "broadcast" | "confirmation";

export interface EscrowRefundSubmissionErrorOptions {
  /** Signature, once the transaction has been signed. */
  signature?: string;
  originalError?: unknown;
}

/**
 * Phase-tagged refund submission failure. Callers may only safely return an
 * escrow to `PENDING` when the failure happened during preflight, i.e. before
 * any signed transaction could have reached the cluster.
 */
export class EscrowRefundSubmissionError extends Error {
  public readonly phase: EscrowRefundSubmissionPhase;
  public readonly signature?: string;
  public readonly originalError?: unknown;

  constructor(
    phase: EscrowRefundSubmissionPhase,
    message: string,
    options: EscrowRefundSubmissionErrorOptions = {},
  ) {
    super(message);
    this.name = "EscrowRefundSubmissionError";
    this.phase = phase;
    this.signature = options.signature;
    this.originalError = options.originalError;
  }
}

export interface SubmitEscrowRefundParams {
  bookingId: string;
  /** Wallet that deposited into the escrow PDA and receives the refund. */
  depositorWallet: string;
  /** Cluster authority keypair that signs the refund transaction. */
  authority: Keypair;
  reason?: string;
  /** Unix timestamp (seconds) recorded in the refund instruction. */
  closureTimestamp?: number;
  /** Defaults to NEXT_PUBLIC_ESCROW_PROGRAM_ID at call time. */
  programId?: string;
  /** Defaults to the shared escrow RPC pool. */
  pool?: EscrowRpcConnectionPool;
  /**
   * Invoked with the signed signature before the transaction is broadcast.
   * The cron uses this to persist the signature, making retries reconcilable.
   */
  onSigned?: (signature: string) => Promise<void> | void;
  confirmationTimeoutMs?: number;
  pollIntervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface EscrowRefundSubmissionResult {
  signature: string;
  escrowVault: string;
  slot?: number;
}

/**
 * Signs and submits an escrow refund transaction, then polls the RPC pool
 * until the signature is confirmed or finalized.
 *
 * Ordering is deliberate: the transaction is signed locally, `onSigned` runs
 * before `sendRawTransaction`, and confirmation is checked through
 * `getSignatureStatuses` (rather than `confirmTransaction`, whose long-lived
 * websocket subscription does not fit the pool's request timeout).
 */
export async function submitEscrowRefundTransaction(
  params: SubmitEscrowRefundParams,
): Promise<EscrowRefundSubmissionResult> {
  const preflightError = (message: string, originalError?: unknown) =>
    new EscrowRefundSubmissionError("preflight", message, { originalError });

  const bookingId =
    typeof params.bookingId === "string" ? params.bookingId.trim() : "";
  if (!bookingId) {
    throw preflightError("bookingId is required to submit an escrow refund");
  }

  let depositor: PublicKey;
  try {
    depositor = new PublicKey(params.depositorWallet);
  } catch {
    throw preflightError(
      `depositorWallet "${params.depositorWallet}" is not a valid Solana address`,
    );
  }

  if (
    !params.authority ||
    !params.authority.publicKey ||
    !params.authority.secretKey
  ) {
    throw preflightError(
      "An escrow authority keypair is required to sign refund transactions",
    );
  }

  const configuredProgramId =
    params.programId ?? process.env.NEXT_PUBLIC_ESCROW_PROGRAM_ID;
  if (!configuredProgramId) {
    throw preflightError(
      "NEXT_PUBLIC_ESCROW_PROGRAM_ID is not configured; escrow refunds cannot be submitted",
    );
  }
  let programId: PublicKey;
  try {
    programId = new PublicKey(configuredProgramId);
  } catch {
    throw preflightError(
      `NEXT_PUBLIC_ESCROW_PROGRAM_ID "${configuredProgramId}" is not a valid Solana program address`,
    );
  }
  if (isPlaceholderProgramId(programId)) {
    throw preflightError(
      "Escrow refunds require a deployed on-chain escrow program. Set NEXT_PUBLIC_ESCROW_PROGRAM_ID to a valid program address.",
    );
  }

  const pool = params.pool ?? getEscrowRpcPool();
  const authority = params.authority;
  const closureTimestamp =
    params.closureTimestamp ?? Math.floor(Date.now() / 1000);
  const reason = params.reason ?? "Escrow hold expired";

  let transaction: Transaction;
  let signature: string;
  let escrowVault: string;
  try {
    const { blockhash } = await pool.execute((connection) =>
      connection.getLatestBlockhash("confirmed"),
    );
    const { address } = deriveEscrowPDA(bookingId, programId);
    escrowVault = address.toBase58();

    const instruction = createRefundInstruction({
      bookingId,
      reason,
      closureTimestamp,
      depositorWallet: depositor,
      authorityWallet: authority.publicKey,
      programId,
    });

    transaction = new Transaction({
      recentBlockhash: blockhash,
      feePayer: authority.publicKey,
    });
    transaction.add(instruction);
    transaction.sign(authority);

    if (!transaction.signature) {
      throw new Error("transaction signing produced no signature");
    }
    signature = encodeBase58(new Uint8Array(transaction.signature));
  } catch (error) {
    if (error instanceof EscrowRefundSubmissionError) throw error;
    throw preflightError(
      `Failed to prepare the escrow refund transaction: ${toEscrowErrorMessage(error)}`,
      error,
    );
  }

  if (params.onSigned) {
    try {
      await params.onSigned(signature);
    } catch (error) {
      throw new EscrowRefundSubmissionError(
        "preflight",
        `Failed to persist the refund signature before broadcast: ${toEscrowErrorMessage(error)}`,
        { signature, originalError: error },
      );
    }
  }

  try {
    await pool.execute((connection) =>
      connection.sendRawTransaction(transaction.serialize(), {
        skipPreflight: false,
        preflightCommitment: "confirmed",
        maxRetries: 3,
      }),
    );
  } catch (error) {
    throw new EscrowRefundSubmissionError(
      "broadcast",
      `Failed to broadcast escrow refund transaction ${signature}: ${toEscrowErrorMessage(error)}`,
      { signature, originalError: error },
    );
  }

  const pollIntervalMs =
    typeof params.pollIntervalMs === "number" && params.pollIntervalMs > 0
      ? params.pollIntervalMs
      : ESCROW_POLL_INTERVAL_MS;
  const confirmationTimeoutMs =
    typeof params.confirmationTimeoutMs === "number" &&
    params.confirmationTimeoutMs >= 0
      ? params.confirmationTimeoutMs
      : ESCROW_CONFIRMATION_TIMEOUT_MS;
  const sleep =
    params.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const maxAttempts = Math.max(
    1,
    Math.ceil(confirmationTimeoutMs / pollIntervalMs),
  );

  let lastRpcError: string | null = null;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const statuses = await pool.execute((connection) =>
        connection.getSignatureStatuses([signature], {
          searchTransactionHistory: true,
        }),
      );
      const status = statuses?.value?.[0] ?? null;

      if (status) {
        if (status.err) {
          throw new EscrowRefundSubmissionError(
            "confirmation",
            `Escrow refund transaction ${signature} failed on-chain: ${JSON.stringify(status.err)}`,
            { signature },
          );
        }
        if (
          status.confirmationStatus === "confirmed" ||
          status.confirmationStatus === "finalized" ||
          status.confirmations === null
        ) {
          return { signature, escrowVault, slot: status.slot };
        }
      }
    } catch (error) {
      if (error instanceof EscrowRefundSubmissionError) throw error;
      lastRpcError = toEscrowErrorMessage(error);
    }

    if (attempt + 1 < maxAttempts) {
      await sleep(pollIntervalMs);
    }
  }

  throw new EscrowRefundSubmissionError(
    "confirmation",
    `Escrow refund transaction ${signature} was not confirmed within ${confirmationTimeoutMs}ms` +
      (lastRpcError ? ` (last RPC error: ${lastRpcError})` : ""),
    { signature },
  );
}

export type EscrowRefundVerificationStatus =
  "confirmed" | "failed" | "pending" | "unknown";

export interface EscrowRefundVerification {
  status: EscrowRefundVerificationStatus;
  signature: string;
  slot?: number | null;
  confirmationStatus?: string | null;
  error?: string;
}

/**
 * Verifies a previously broadcast refund signature against the RPC quorum.
 * `unknown` means the cluster has not observed the signature yet (or every
 * endpoint errored), which callers must treat as "still in flight" rather than
 * as a failure, so the escrow is never returned to the refundable state.
 */
export async function verifyEscrowRefundTransaction(params: {
  signature: string;
  pool?: EscrowRpcConnectionPool;
}): Promise<EscrowRefundVerification> {
  const signature =
    typeof params.signature === "string" ? params.signature.trim() : "";
  if (!signature) {
    return {
      status: "unknown",
      signature: "",
      error: "Transaction signature is required",
    };
  }

  const pool = params.pool ?? getEscrowRpcPool();
  try {
    const statuses = await pool.execute((connection) =>
      connection.getSignatureStatuses([signature], {
        searchTransactionHistory: true,
      }),
    );
    const status = statuses?.value?.[0] ?? null;

    if (!status) {
      return { status: "unknown", signature };
    }
    if (status.err) {
      return {
        status: "failed",
        signature,
        slot: status.slot,
        error: JSON.stringify(status.err),
      };
    }
    if (
      status.confirmationStatus === "confirmed" ||
      status.confirmationStatus === "finalized" ||
      status.confirmations === null
    ) {
      return {
        status: "confirmed",
        signature,
        slot: status.slot,
        confirmationStatus: status.confirmationStatus ?? null,
      };
    }
    return {
      status: "pending",
      signature,
      slot: status.slot,
      confirmationStatus: status.confirmationStatus ?? null,
    };
  } catch (error) {
    return {
      status: "unknown",
      signature,
      error: toEscrowErrorMessage(error),
    };
  }
}

// ===========================================================================
// Escrow RPC connection pool with node failover (#7529)
// ===========================================================================
//
// Public RPC endpoints frequently rate limit (HTTP 429), shed load (503), or
// stall on connections. Desk reservations must survive these transient
// failures without failing the escrow flow, so every RPC interaction is routed
// through a redundant endpoint pool that:
//   1. Retries the active endpoint with exponential backoff + jitter.
//   2. Rotates to the next endpoint on HTTP 429/503 or connection timeouts
//      (>4,000ms), and keeps rotating until one succeeds.
//   3. Tracks per-endpoint health via periodic lightweight pings.
// Seat reservations use optimistic UI confirmation upon signature broadcast,
// then poll signature status in the background until finality
// (confirmed -> finalized), rolling back if the transaction fails or drops.

/** Public RPC endpoint used when no cluster is configured. */
export const ESCROW_RPC_DEFAULT_ENDPOINT = "https://api.devnet.solana.com";

/** Connection timeout threshold; attempts slower than this trigger failover. */
export const ESCROW_RPC_REQUEST_TIMEOUT_MS = 4_000;
export const ESCROW_RPC_MAX_RETRIES_PER_ENDPOINT = 2;
export const ESCROW_RPC_BASE_BACKOFF_MS = 250;
export const ESCROW_RPC_MAX_BACKOFF_MS = 8_000;
export const ESCROW_RPC_JITTER_RATIO = 0.2;
export const ESCROW_RPC_HEALTH_CHECK_INTERVAL_MS = 30_000;

/** Background signature status poll cadence for optimistic confirmations. */
export const ESCROW_POLL_INTERVAL_MS = 2_000;
export const ESCROW_CONFIRMATION_TIMEOUT_MS = 60_000;

export interface EscrowRpcPoolConfig {
  /** Ordered RPC endpoints; the first healthy endpoint becomes the active node. */
  endpoints?: string[];
  /** Commitment applied to pool connections (default "confirmed"). */
  commitment?: Commitment;
  /** Per-attempt connection timeout in ms; 0 disables the timeout. */
  requestTimeoutMs?: number;
  /** Retries against the same endpoint (with backoff) before failing over. */
  maxRetriesPerEndpoint?: number;
  /** Initial delay for exponential backoff (ms). */
  baseDelayMs?: number;
  /** Upper bound for exponential backoff (ms). */
  maxDelayMs?: number;
  /** Portion of randomness added to each delay to avoid thundering herds. */
  jitterRatio?: number;
}

export interface EscrowRpcEndpointHealth {
  endpoint: string;
  healthy: boolean;
  latencyMs: number | null;
  lastCheckedAt: number | null;
  consecutiveFailures: number;
  lastError: string | null;
}

export interface EscrowRpcAttemptFailure {
  endpoint: string;
  error: string;
}

/** Thrown when an RPC attempt exceeds the connection timeout threshold. */
export class EscrowRpcTimeoutError extends Error {
  public readonly timeoutMs: number;
  public readonly endpoint: string;

  constructor(timeoutMs: number, endpoint: string) {
    super(`RPC request to ${endpoint} timed out after ${timeoutMs}ms`);
    this.name = "EscrowRpcTimeoutError";
    this.timeoutMs = timeoutMs;
    this.endpoint = endpoint;
  }
}

/** Thrown once every endpoint in the pool has been exhausted. */
export class EscrowRpcFailoverError extends Error {
  public readonly attempts: EscrowRpcAttemptFailure[];

  constructor(
    attempts: EscrowRpcAttemptFailure[],
    message = "All escrow RPC endpoints failed",
  ) {
    super(message);
    this.name = "EscrowRpcFailoverError";
    this.attempts = attempts;
  }
}

export interface EscrowRpcPoolDependencies {
  createConnection?: (
    endpoint: string,
    commitment: Commitment,
  ) => Connection | Promise<Connection>;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  now?: () => number;
  isRetryable?: (error: unknown) => boolean;
}

const ESCROW_RPC_URL_PATTERN = /^https?:\/\//i;

function toEscrowErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function clampFiniteNumber(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, value));
}

/**
 * Resolves an ordered, de-duplicated RPC endpoint cluster from the environment.
 * Supports comma/whitespace separated pools via `NEXT_PUBLIC_SOLANA_RPC_URLS` /
 * `SOLANA_RPC_URLS` plus the legacy single-endpoint `SOLANA_RPC_URL` value,
 * falling back to the public devnet endpoint when nothing is configured.
 */
export function resolveEscrowRpcEndpoints(
  env: Record<string, string | undefined> = typeof process !== "undefined"
    ? process.env
    : {},
): string[] {
  const candidates = [
    env.NEXT_PUBLIC_SOLANA_RPC_URLS,
    env.SOLANA_RPC_URLS,
    env.NEXT_PUBLIC_SOLANA_RPC_URL,
    env.SOLANA_RPC_URL,
  ];

  const endpoints: string[] = [];
  for (const candidate of candidates) {
    if (!candidate) continue;
    for (const piece of candidate.split(/[\s,]+/)) {
      const endpoint = piece.trim();
      if (
        endpoint &&
        ESCROW_RPC_URL_PATTERN.test(endpoint) &&
        !endpoints.includes(endpoint)
      ) {
        endpoints.push(endpoint);
      }
    }
  }

  if (endpoints.length === 0) {
    endpoints.push(ESCROW_RPC_DEFAULT_ENDPOINT);
  }
  return endpoints;
}

const RETRYABLE_ESCROW_RPC_STATUS_CODES = new Set([429, 503]);

/**
 * Classifies RPC errors that should trigger an exponential-backoff retry or a
 * failover to the next endpoint: HTTP 429, 503, connection timeouts, and
 * transient network failures. Deterministic request/validation errors are not.
 */
export function isEscrowRpcRetryableError(error: unknown): boolean {
  if (!error) return false;
  if (error instanceof EscrowRpcTimeoutError) return true;

  const candidate = error as {
    message?: unknown;
    code?: unknown;
    status?: unknown;
    statusCode?: unknown;
  };

  for (const code of [candidate.status, candidate.statusCode, candidate.code]) {
    if (
      typeof code === "number" &&
      RETRYABLE_ESCROW_RPC_STATUS_CODES.has(code)
    ) {
      return true;
    }
  }

  const message =
    typeof error === "string"
      ? error
      : typeof candidate.message === "string"
        ? candidate.message
        : "";
  if (!message) return false;

  const normalized = message.toLowerCase();
  return [
    "429",
    "503",
    "rate limit",
    "too many requests",
    "service unavailable",
    "timeout",
    "timed out",
    "etimedout",
    "econnreset",
    "econnrefused",
    "enotfound",
    "eai_again",
    "socket hang up",
    "fetch failed",
    "network error",
    "temporarily unavailable",
    "node is unhealthy",
  ].some((token) => normalized.includes(token));
}

/**
 * Computes an exponential backoff delay with optional jitter.
 * attempt 0 -> baseDelayMs, attempt 1 -> 2 * baseDelayMs, capped at maxDelayMs.
 */
export function computeEscrowRpcBackoffDelay(
  attempt: number,
  baseDelayMs: number = ESCROW_RPC_BASE_BACKOFF_MS,
  maxDelayMs: number = ESCROW_RPC_MAX_BACKOFF_MS,
  jitterRatio: number = ESCROW_RPC_JITTER_RATIO,
  random: () => number = Math.random,
): number {
  const safeAttempt = Math.max(0, Math.floor(attempt));
  const safeBase = Math.max(0, baseDelayMs);
  const safeMax = Math.max(safeBase, maxDelayMs);
  const exponential = Math.min(safeMax, safeBase * Math.pow(2, safeAttempt));
  const jitter = exponential * Math.max(0, Math.min(1, jitterRatio)) * random();

  return Math.round(Math.min(safeMax, exponential + jitter));
}

/**
 * RPC connection pool manager for the escrow flow.
 *
 * Every operation is attempted against the active endpoint with exponential
 * backoff between retries. HTTP 429/503 responses or connection timeouts
 * (>4,000ms) rotate the pool to the next endpoint; endpoints failing health
 * pings are deprioritized until they recover. Only after every endpoint is
 * exhausted does `execute` throw an `EscrowRpcFailoverError`.
 */
export class EscrowRpcConnectionPool {
  private readonly endpoints: string[];
  private readonly commitment: Commitment;
  private readonly requestTimeoutMs: number;
  private readonly maxRetriesPerEndpoint: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly jitterRatio: number;
  private readonly createConnection?: EscrowRpcPoolDependencies["createConnection"];
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;
  private readonly now: () => number;
  private readonly isRetryable: (error: unknown) => boolean;
  private readonly connections = new Map<string, Connection>();
  private readonly health = new Map<string, EscrowRpcEndpointHealth>();
  private activeIndex = 0;
  private healthTimer?: ReturnType<typeof setInterval>;

  constructor(
    config: EscrowRpcPoolConfig = {},
    dependencies: EscrowRpcPoolDependencies = {},
  ) {
    const configured = (config.endpoints ?? []).map((endpoint) =>
      endpoint.trim(),
    );
    const endpoints = (
      configured.length > 0 ? configured : resolveEscrowRpcEndpoints()
    ).filter((endpoint) => ESCROW_RPC_URL_PATTERN.test(endpoint));

    this.endpoints = Array.from(new Set(endpoints));
    this.commitment = config.commitment ?? "confirmed";
    this.requestTimeoutMs = clampFiniteNumber(
      config.requestTimeoutMs,
      ESCROW_RPC_REQUEST_TIMEOUT_MS,
      0,
      300_000,
    );
    this.maxRetriesPerEndpoint = Math.floor(
      clampFiniteNumber(
        config.maxRetriesPerEndpoint,
        ESCROW_RPC_MAX_RETRIES_PER_ENDPOINT,
        0,
        10,
      ),
    );
    this.baseDelayMs = clampFiniteNumber(
      config.baseDelayMs,
      ESCROW_RPC_BASE_BACKOFF_MS,
      0,
      60_000,
    );
    this.maxDelayMs = clampFiniteNumber(
      config.maxDelayMs,
      ESCROW_RPC_MAX_BACKOFF_MS,
      this.baseDelayMs,
      300_000,
    );
    this.jitterRatio = clampFiniteNumber(
      config.jitterRatio,
      ESCROW_RPC_JITTER_RATIO,
      0,
      1,
    );

    this.createConnection = dependencies.createConnection;
    this.sleep =
      dependencies.sleep ??
      ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    this.random = dependencies.random ?? Math.random;
    this.now = dependencies.now ?? Date.now;
    this.isRetryable = dependencies.isRetryable ?? isEscrowRpcRetryableError;
  }

  /** Ordered endpoint cluster managed by this pool. */
  public getEndpoints(): string[] {
    return [...this.endpoints];
  }

  /** Currently selected (active) endpoint, or null when none are configured. */
  public getActiveEndpoint(): string | null {
    return this.endpoints[this.activeIndex] ?? null;
  }

  /** Connection for the active endpoint, creating it on first use. */
  public async getActiveConnection(): Promise<Connection> {
    const endpoint = this.getActiveEndpoint();
    if (!endpoint) {
      throw new EscrowRpcFailoverError(
        [],
        "No escrow RPC endpoints are configured",
      );
    }
    return this.getConnection(endpoint);
  }

  /** Snapshot of per-endpoint health across the cluster. */
  public getHealthReport(): EscrowRpcEndpointHealth[] {
    return this.endpoints.map((endpoint) => {
      const record = this.health.get(endpoint);
      return record
        ? { ...record }
        : {
            endpoint,
            healthy: true,
            latencyMs: null,
            lastCheckedAt: null,
            consecutiveFailures: 0,
            lastError: null,
          };
    });
  }

  /**
   * Runs `operation` against the pool with failover. Retryable failures
   * (429/503/timeout) trigger exponential-backoff retries against the current
   * endpoint, then rotation to the next node; unhealthy endpoints are tried
   * last. Resolves with the first successful result.
   */
  public async execute<T>(
    operation: (connection: Connection, endpoint: string) => Promise<T>,
  ): Promise<T> {
    if (this.endpoints.length === 0) {
      throw new EscrowRpcFailoverError(
        [],
        "No escrow RPC endpoints are configured",
      );
    }

    const startIndex = this.activeIndex % this.endpoints.length;
    const rotation = Array.from(
      { length: this.endpoints.length },
      (_, offset) => (startIndex + offset) % this.endpoints.length,
    );

    // Prefer endpoints that have not failed a recent health check; if every
    // endpoint is unhealthy, keep trying them all rather than giving up.
    const healthyRotation = rotation.filter(
      (index) => this.health.get(this.endpoints[index])?.healthy !== false,
    );
    const candidates = healthyRotation.length > 0 ? healthyRotation : rotation;

    const failures: EscrowRpcAttemptFailure[] = [];

    for (const index of candidates) {
      const endpoint = this.endpoints[index];
      const connection = await this.getConnection(endpoint);

      for (
        let attempt = 0;
        attempt <= this.maxRetriesPerEndpoint;
        attempt += 1
      ) {
        try {
          const startedAt = this.now();
          const result = await this.withTimeout(
            operation(connection, endpoint),
            endpoint,
          );
          this.recordSuccess(endpoint, this.now() - startedAt);
          this.activeIndex = index;
          return result;
        } catch (error) {
          const retryable = this.isRetryable(error);
          failures.push({ endpoint, error: toEscrowErrorMessage(error) });
          if (retryable) {
            this.recordFailure(endpoint, error);
          }

          if (attempt >= this.maxRetriesPerEndpoint || !retryable) {
            break;
          }

          await this.sleep(
            computeEscrowRpcBackoffDelay(
              attempt,
              this.baseDelayMs,
              this.maxDelayMs,
              this.jitterRatio,
              this.random,
            ),
          );
        }
      }
    }

    // Leave the active pointer advanced past the endpoint we started on so the
    // next operation gets a fresh rotation.
    this.activeIndex = (startIndex + 1) % this.endpoints.length;
    throw new EscrowRpcFailoverError(failures);
  }

  /**
   * Health-check ping for a single endpoint using a lightweight
   * getLatestBlockhash request. Records latency and marks the node
   * healthy/unhealthy for rotation decisions.
   */
  public async checkEndpointHealth(
    endpoint?: string,
  ): Promise<EscrowRpcEndpointHealth | null> {
    const target =
      endpoint && this.endpoints.includes(endpoint)
        ? endpoint
        : this.getActiveEndpoint();
    if (!target) return null;

    const connection = await this.getConnection(target);
    const startedAt = this.now();
    try {
      await this.withTimeout(connection.getLatestBlockhash(), target);
      this.recordSuccess(target, this.now() - startedAt);
    } catch (error) {
      this.recordFailure(target, error);
    }
    const health = this.getHealthReport().find(
      (entry) => entry.endpoint === target,
    )!;
    return health;
  }

  /** Health-check pings every endpoint in the cluster. */
  public async checkAllEndpointsHealth(): Promise<EscrowRpcEndpointHealth[]> {
    const reports: EscrowRpcEndpointHealth[] = [];
    for (const endpoint of this.endpoints) {
      const report = await this.checkEndpointHealth(endpoint);
      if (report) reports.push(report);
    }
    return reports;
  }

  /**
   * Starts periodic background health-check pinging across the cluster.
   * Idempotent; call `stopHealthMonitoring` to halt.
   */
  public startHealthMonitoring(
    intervalMs: number = ESCROW_RPC_HEALTH_CHECK_INTERVAL_MS,
  ): void {
    if (this.healthTimer !== undefined) return;
    this.healthTimer = setInterval(() => {
      void this.checkAllEndpointsHealth().catch(() => {});
    }, intervalMs);
    this.healthTimer.unref?.();
  }

  /** Stops periodic health monitoring if it is running. */
  public stopHealthMonitoring(): void {
    if (this.healthTimer === undefined) return;
    clearInterval(this.healthTimer);
    this.healthTimer = undefined;
  }

  private async getConnection(endpoint: string): Promise<Connection> {
    const existing = this.connections.get(endpoint);
    if (existing) return existing;

    let connection: Connection;
    if (this.createConnection) {
      connection = await this.createConnection(endpoint, this.commitment);
    } else {
      const { Connection: SolanaConnection } = await import("@solana/web3.js");
      connection = new SolanaConnection(endpoint, this.commitment);
    }

    this.connections.set(endpoint, connection);
    return connection;
  }

  private withTimeout<T>(promise: Promise<T>, endpoint: string): Promise<T> {
    if (this.requestTimeoutMs <= 0) return promise;

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new EscrowRpcTimeoutError(this.requestTimeoutMs, endpoint));
      }, this.requestTimeoutMs);
      timer.unref?.();
      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        },
      );
    });
  }

  private recordSuccess(endpoint: string, latencyMs?: number): void {
    const record = this.ensureHealthRecord(endpoint);
    record.healthy = true;
    record.consecutiveFailures = 0;
    record.lastError = null;
    record.lastCheckedAt = this.now();
    if (typeof latencyMs === "number" && Number.isFinite(latencyMs)) {
      record.latencyMs = Math.max(0, latencyMs);
    }
  }

  private recordFailure(endpoint: string, error: unknown): void {
    const record = this.ensureHealthRecord(endpoint);
    record.healthy = false;
    record.consecutiveFailures += 1;
    record.lastError = toEscrowErrorMessage(error);
    record.lastCheckedAt = this.now();
  }

  private ensureHealthRecord(endpoint: string): EscrowRpcEndpointHealth {
    let record = this.health.get(endpoint);
    if (!record) {
      record = {
        endpoint,
        healthy: true,
        latencyMs: null,
        lastCheckedAt: null,
        consecutiveFailures: 0,
        lastError: null,
      };
      this.health.set(endpoint, record);
    }
    return record;
  }
}

let defaultEscrowRpcPool: EscrowRpcConnectionPool | null = null;

/** Shared RPC pool singleton for escrow flows. */
export function getEscrowRpcPool(
  config?: EscrowRpcPoolConfig,
): EscrowRpcConnectionPool {
  if (!defaultEscrowRpcPool) {
    defaultEscrowRpcPool = new EscrowRpcConnectionPool(config);
  }
  return defaultEscrowRpcPool;
}

/** Resets the shared RPC pool (useful for tests). */
export function resetEscrowRpcPool(): void {
  defaultEscrowRpcPool = null;
}

export interface EscrowClientConfig {
  /** RPC pool settings (endpoints, timeouts, backoff, failover). */
  rpc?: EscrowRpcPoolConfig;
  /** Background status poll cadence for optimistic confirmations. */
  pollIntervalMs?: number;
  /** Overall window before an unconfirmed reservation rolls back. */
  confirmationTimeoutMs?: number;
}

/**
 * Parameters for an optimistic seat reservation driven by the escrow client.
 * The RPC connection is supplied by the pool; confirmation is tracked via
 * background polling rather than WebSocket subscriptions.
 */
export type EscrowSeatReservationParams = Omit<
  ReserveSeatOptions,
  "connection" | "confirmationMode" | "pollSignatureStatus"
>;

/**
 * EscrowClient — high-level desk reservation client backed by the failover
 * RPC pool.
 *
 * `reserveSeat` transitions the seat to provisionally_reserved the moment a
 * wallet broadcasts the payment signature (optimistic UI), then polls the
 * signature status through the pool in the background until the transaction
 * reaches finality (confirmed -> finalized), rolling the seat back to
 * available if the transaction fails or drops from the mempool.
 */
export class EscrowClient {
  public readonly pool: EscrowRpcConnectionPool;
  private readonly escrowManager: SolanaPayEscrowManager;
  private readonly pollIntervalMs: number;
  private readonly confirmationTimeoutMs: number;

  constructor(
    config: EscrowClientConfig = {},
    pool?: EscrowRpcConnectionPool,
    escrowManager?: SolanaPayEscrowManager,
  ) {
    this.pool = pool ?? new EscrowRpcConnectionPool(config.rpc);
    this.escrowManager = escrowManager ?? solanaPayEscrowManager;
    this.pollIntervalMs = config.pollIntervalMs ?? ESCROW_POLL_INTERVAL_MS;
    this.confirmationTimeoutMs =
      config.confirmationTimeoutMs ?? ESCROW_CONFIRMATION_TIMEOUT_MS;
  }

  /** Underlying RPC connection pool (failover-aware). */
  public getRpcPool(): EscrowRpcConnectionPool {
    return this.pool;
  }

  /** Currently active RPC endpoint, or null when none are configured. */
  public getActiveEndpoint(): string | null {
    return this.pool.getActiveEndpoint();
  }

  /** Fetches the latest blockhash through the failover pool. */
  public async getLatestBlockhash(): Promise<
    Awaited<ReturnType<Connection["getLatestBlockhash"]>>
  > {
    return this.pool.execute((connection) => connection.getLatestBlockhash());
  }

  /** Fetches a transaction's signature status through the failover pool. */
  public async getSignatureStatus(
    signature: string,
  ): Promise<SignatureStatus | null> {
    const response = await this.pool.execute((connection) =>
      connection.getSignatureStatuses([signature], {
        searchTransactionHistory: true,
      }),
    );
    return response.value?.[0] ?? null;
  }

  /**
   * Optimistically reserves a seat upon signature broadcast.
   *
   * Immediately transitions the seat to provisionally_reserved (optimistic UI
   * confirmation) and starts background status polling across the RPC pool
   * until the transaction finalizes. Rolls back to available on failure or
   * mempool drop.
   */
  public async reserveSeat(
    params: EscrowSeatReservationParams,
  ): Promise<SeatReservationState> {
    const connection = await this.pool.getActiveConnection();

    return this.escrowManager.reserveSeatOptimistically({
      ...params,
      connection,
      timeoutMs: params.timeoutMs ?? this.confirmationTimeoutMs,
      pollIntervalMs: params.pollIntervalMs ?? this.pollIntervalMs,
      confirmationMode: "polling",
      pollSignatureStatus: (signature) => this.getSignatureStatus(signature),
    });
  }
}

let defaultEscrowClient: EscrowClient | null = null;

/** Shared EscrowClient singleton backed by the shared RPC pool. */
export function getEscrowClient(config?: EscrowClientConfig): EscrowClient {
  if (!defaultEscrowClient) {
    defaultEscrowClient = new EscrowClient(
      config,
      getEscrowRpcPool(config?.rpc),
    );
  }
  return defaultEscrowClient;
}

/** Resets the shared EscrowClient (useful for tests). */
export function resetEscrowClient(): void {
  defaultEscrowClient = null;
}

export * from "./solanaPayEscrow";

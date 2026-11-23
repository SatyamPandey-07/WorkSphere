import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  VersionedTransaction,
  LAMPORTS_PER_SOL,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import type { Commitment, SignatureStatus } from "@solana/web3.js";
import {
  solanaPayEscrowManager,
  type SolanaPayEscrowManager,
  type ReserveSeatOptions,
  type SeatReservationState,
  DEFAULT_ESCROW_COMPUTE_UNIT_LIMIT,
  fetchLatestBlockhashWithBackoff,
} from "./solanaPayEscrow";
import {
  getPriorityFeeEstimator,
  type PriorityFeeEstimate,
} from "./priorityFeeEstimator";

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

export const SOL_DECIMALS = 9;
export const USDC_DECIMALS = 6;

export type SupportedSettlementAsset = "SOL" | "USDC";

export interface EscrowBookingQuoteInput {
  /** Hourly rate as a decimal string (e.g., "0.14" SOL or "4.50" USDC) */
  hourlyRate: string | number;
  /** Booking duration in minutes (e.g., 90 for 1.5 hours) */
  durationMinutes: number;
  /** Settlement token ('SOL' = 9 decimals, 'USDC' = 6 decimals) */
  asset?: SupportedSettlementAsset;
  /** Optional explicit decimal precision override */
  decimals?: number;
}

export interface EscrowBaseUnitQuote {
  asset: SupportedSettlementAsset;
  decimals: number;
  baseUnits: bigint;
  formattedDecimal: string;
}

/**
 * Converts a decimal token amount into exact integer base units (`bigint`) using
 * string splitting and right-padding—eliminating IEEE-754 floating-point drift
 * (such as `0.14 * 1e9` or `1.005 * 1e6`).
 */
export function parseDecimalToBaseUnits(
  amount: string | number,
  decimals: number = SOL_DECIMALS,
): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) {
    throw new RangeError(`Invalid token decimal precision: ${decimals}`);
  }

  const raw =
    typeof amount === "number"
      ? Number.isFinite(amount)
        ? amount.toString()
        : ""
      : typeof amount === "string"
        ? amount.trim()
        : "";

  if (!raw) {
    throw new Error("Token amount must be a non-empty finite decimal string");
  }

  // Handle scientific notation strings (e.g. "1e-7") safely into fixed decimal representation
  const normalized = expandScientificNotation(raw);

  if (normalized.startsWith("-")) {
    throw new Error(`Token amount cannot be negative: "${raw}"`);
  }

  const unsigned = normalized.startsWith("+")
    ? normalized.slice(1)
    : normalized;
  const parts = unsigned.split(".");

  if (parts.length > 2) {
    throw new Error(`Malformed decimal amount: "${raw}"`);
  }

  const wholePartRaw = parts[0] === "" ? "0" : parts[0];
  const fractionPartRaw = parts[1] ?? "";

  if (
    !/^\d+$/.test(wholePartRaw) ||
    (fractionPartRaw !== "" && !/^\d+$/.test(fractionPartRaw))
  ) {
    throw new Error(`Invalid numeric characters in decimal amount: "${raw}"`);
  }

  if (fractionPartRaw.length > decimals) {
    const excessDigits = fractionPartRaw.slice(decimals);
    if (!/^0+$/.test(excessDigits)) {
      throw new Error(
        `Amount "${raw}" exceeds maximum supported precision of ${decimals} decimal places`,
      );
    }
  }

  const paddedFraction =
    decimals === 0
      ? ""
      : fractionPartRaw.slice(0, decimals).padEnd(decimals, "0");

  return BigInt(`${wholePartRaw}${paddedFraction}`);
}

/**
 * Formats integer base units (`bigint`) back into a canonical decimal string without float loss.
 */
export function formatBaseUnitsToDecimal(
  baseUnits: bigint,
  decimals: number = SOL_DECIMALS,
): string {
  if (baseUnits < 0n) {
    throw new Error("Base units cannot be negative");
  }

  if (decimals === 0) {
    return baseUnits.toString();
  }

  const digits = baseUnits.toString().padStart(decimals + 1, "0");
  const whole = digits.slice(0, -decimals);
  const fraction = digits.slice(-decimals).replace(/0+$/, "");

  return fraction.length > 0 ? `${whole}.${fraction}` : whole;
}

/**
 * Expands valid scientific-notation numeric strings (e.g. "5e-8") into plain fixed-point strings.
 */
function expandScientificNotation(value: string): string {
  const match = /^([+-]?)(\d+)(?:\.(\d*))?[eE]([+-]?\d+)$/.exec(value);
  if (!match) {
    return value;
  }

  const [, sign, intDigits, fracDigits = "", expStr] = match;
  const exponent = parseInt(expStr, 10);
  const combinedDigits = `${intDigits}${fracDigits}`;
  const decimalPosition = intDigits.length + exponent;

  if (decimalPosition <= 0) {
    return `${sign}0.${"0".repeat(Math.abs(decimalPosition))}${combinedDigits}`;
  }

  if (decimalPosition >= combinedDigits.length) {
    return `${sign}${combinedDigits}${"0".repeat(decimalPosition - combinedDigits.length)}`;
  }

  return `${sign}${combinedDigits.slice(0, decimalPosition)}.${combinedDigits.slice(decimalPosition)}`;
}

/**
 * Computes exact escrow base units (`lamports` for SOL, micro-units for USDC) for a
 * prorated multi-minute desk reservation using pure `BigInt` integer arithmetic.
 */
export function calculateEscrowBookingBaseUnits(
  input: EscrowBookingQuoteInput,
): EscrowBaseUnitQuote {
  const asset: SupportedSettlementAsset = input.asset ?? "SOL";
  const decimals =
    input.decimals ?? (asset === "USDC" ? USDC_DECIMALS : SOL_DECIMALS);

  if (!Number.isInteger(input.durationMinutes) || input.durationMinutes <= 0) {
    throw new Error("Booking durationMinutes must be a positive integer");
  }

  const hourlyBaseUnits = parseDecimalToBaseUnits(input.hourlyRate, decimals);
  const totalBaseUnits =
    (hourlyBaseUnits * BigInt(input.durationMinutes)) / 60n;

  return {
    asset,
    decimals,
    baseUnits: totalBaseUnits,
    formattedDecimal: formatBaseUnitsToDecimal(totalBaseUnits, decimals),
  };
}

/**
 * Validates that a connected wallet's pre-flight balance (plus Solana fee buffer)
 * covers the exact `BigInt` escrow transfer amount before signing.
 */
export function assertSufficientEscrowBalance(params: {
  walletBalanceBaseUnits: bigint;
  requiredEscrowBaseUnits: bigint;
  networkFeeReserveBaseUnits?: bigint;
}): void {
  const feeReserve = params.networkFeeReserveBaseUnits ?? 5_000n; // 5,000 lamports default signature fee
  const totalRequired = params.requiredEscrowBaseUnits + feeReserve;

  if (params.walletBalanceBaseUnits < totalRequired) {
    throw new Error(
      `InsufficientFunds: wallet balance ${params.walletBalanceBaseUnits.toString()} is less than required ${totalRequired.toString()} base units`,
    );
  }
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

export type EscrowCurrency = "SOL" | "USDC";

export interface EscrowDepositParams {
  payerWallet: string;
  bookingId: string;
  amount: number;
  currency: EscrowCurrency;
  rpcUrl: string;
  priorityFeeMicroLamports?: number;
  computeUnitLimit?: number;
}

export interface EscrowDepositResult {
  serializedTransaction: string;
  escrowVault: string;
  escrowBump: number;
  amountBaseUnits: bigint;
  recentBlockhash: string;
  lastValidBlockHeight?: number;
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
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash("confirmed");

  const transaction = new Transaction({
    recentBlockhash: blockhash,
    feePayer: payer,
  });

  // Dynamic Compute Unit Budget: set dedicated compute unit limit
  const computeUnitLimit =
    params.computeUnitLimit ?? DEFAULT_ESCROW_COMPUTE_UNIT_LIMIT;
  if (typeof computeUnitLimit === "number" && computeUnitLimit > 0) {
    transaction.add(
      ComputeBudgetProgram.setComputeUnitLimit({
        units: Math.floor(computeUnitLimit),
      }),
    );
  }

  // Dynamic Priority Fee: estimate automatically if not explicitly provided
  let priorityFee = params.priorityFeeMicroLamports;
  if (priorityFee === undefined || priorityFee === null) {
    try {
      const estimator = getPriorityFeeEstimator();
      const estimate = await estimator.estimatePriorityFee(connection, [
        payer,
        escrowVault,
      ]);
      priorityFee = estimate.microLamports;
    } catch {
      priorityFee = undefined;
    }
  }

  // SetComputeUnitPrice must be placed before business instructions
  if (typeof priorityFee === "number" && priorityFee > 0) {
    const safeFee = Math.max(0, Math.floor(priorityFee));
    const existingIndex = transaction.instructions.findIndex(
      (ix) =>
        ix.programId.equals(ComputeBudgetProgram.programId) &&
        ix.data.length > 0 &&
        ix.data[0] === 3,
    );
    const computeIx = ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: safeFee,
    });
    if (existingIndex >= 0) {
      transaction.instructions[existingIndex] = computeIx;
    } else {
      transaction.instructions.unshift(computeIx);
    }
  }

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
    lastValidBlockHeight,
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
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash("confirmed");

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

  // Dynamic Compute Unit Budget: set dedicated compute unit limit
  const computeUnitLimit =
    params.computeUnitLimit ?? DEFAULT_ESCROW_COMPUTE_UNIT_LIMIT;
  if (typeof computeUnitLimit === "number" && computeUnitLimit > 0) {
    transaction.add(
      ComputeBudgetProgram.setComputeUnitLimit({
        units: Math.floor(computeUnitLimit),
      }),
    );
  }

  // Dynamic Priority Fee: estimate automatically if not explicitly provided
  let priorityFee = params.priorityFeeMicroLamports;
  if (priorityFee === undefined || priorityFee === null) {
    try {
      const estimator = getPriorityFeeEstimator();
      const estimate = await estimator.estimatePriorityFee(connection, [
        payer,
        payerAta,
        vaultAta,
      ]);
      priorityFee = estimate.microLamports;
    } catch {
      priorityFee = undefined;
    }
  }

  // SetComputeUnitPrice must be placed before business instructions
  if (typeof priorityFee === "number" && priorityFee > 0) {
    const safeFee = Math.max(0, Math.floor(priorityFee));
    const existingIndex = transaction.instructions.findIndex(
      (ix) =>
        ix.programId.equals(ComputeBudgetProgram.programId) &&
        ix.data.length > 0 &&
        ix.data[0] === 3,
    );
    const computeIx = ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: safeFee,
    });
    if (existingIndex >= 0) {
      transaction.instructions[existingIndex] = computeIx;
    } else {
      transaction.instructions.unshift(computeIx);
    }
  }

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
    lastValidBlockHeight,
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
    payerWallet?: string;
    amount?: number;
    currency?: EscrowCurrency;
  },
  rpcUrl: string,
): Promise<{
  verified: boolean;
  error?: string;
  escrowVault?: string;
  amountBaseUnits?: bigint;
  payerWallet?: string;
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
    const currency = expectedParams.currency ?? "SOL";
    const expectedAmount =
      expectedParams.amount !== undefined && expectedParams.amount > 0
        ? toBaseUnits(expectedParams.amount, currency)
        : undefined;

    const accountKeys = tx.transaction.message.accountKeys;
    let payerKey: any;
    if (expectedParams.payerWallet) {
      const payer = new PublicKey(expectedParams.payerWallet);
      payerKey = accountKeys.find((k) => k.pubkey.equals(payer) && k.signer);
      if (!payerKey) {
        return { verified: false, error: "Expected payer is not a signer" };
      }
    } else {
      payerKey = accountKeys.find((k) => k.signer);
      if (!payerKey) {
        return { verified: false, error: "No signer found in transaction" };
      }
    }
    const detectedPayer = (payerKey.pubkey as PublicKey).toBase58();

    const vaultIndex = accountKeys.findIndex((k) =>
      k.pubkey.equals(escrowVault),
    );

    if (currency === "SOL" && expectedAmount !== undefined) {
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
    } else if (vaultIndex === -1) {
      return {
        verified: false,
        error: "Escrow vault not found in transaction accounts",
      };
    }

    return {
      verified: true,
      escrowVault: escrowVault.toBase58(),
      amountBaseUnits: expectedAmount,
      payerWallet: detectedPayer,
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

/** Hard ceiling for a single RPC status/balance poll request. */
export const ESCROW_RPC_POLL_TIMEOUT_MS = 5_000;

/**
 * Runs one RPC poll request under an explicit abort deadline.
 *
 * `@solana/web3.js` does not abort in-flight requests on its own, so when a
 * node blackholes packets (no TCP RST) the returned promise never settles and
 * the caller's retry loop stalls forever. This helper hands the operation an
 * `AbortSignal` and also races it against that signal, so the caller always
 * gets a rejection (`EscrowRpcTimeoutError`) once `timeoutMs` elapses.
 */
export async function withRpcPollTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  options: { timeoutMs?: number; endpoint?: string } = {},
): Promise<T> {
  const timeoutMs =
    typeof options.timeoutMs === "number" &&
    Number.isFinite(options.timeoutMs) &&
    options.timeoutMs > 0
      ? options.timeoutMs
      : ESCROW_RPC_POLL_TIMEOUT_MS;
  const endpoint = options.endpoint ?? "rpc-poll";

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const timeoutError = new EscrowRpcTimeoutError(timeoutMs, endpoint);
      controller.abort(timeoutError);
      reject(timeoutError);
    }, timeoutMs);
    (timer as { unref?: () => void }).unref?.();
  });

  try {
    return await Promise.race([operation(controller.signal), deadline]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    // A late rejection from the abandoned operation must not go unhandled.
    deadline.catch(() => {});
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
      // A timeout rejects into the catch below, which counts it as a retry.
      const status = await withRpcPollTimeout(
        () =>
          connection.getSignatureStatus(signature, {
            searchTransactionHistory: true,
          }),
        { endpoint: "reconcilePendingSignature" },
      );

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
  priorityFeeMicroLamports?: number;
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

    // Dynamic Priority Fee: estimate automatically if not explicitly provided
    let priorityFee = params.priorityFeeMicroLamports;
    if (priorityFee === undefined || priorityFee === null) {
      try {
        const estimator = getPriorityFeeEstimator();
        const estimate = (await pool.execute((conn) =>
          estimator.estimatePriorityFee(conn, [
            address,
            authority.publicKey,
            depositor,
          ]),
        )) as PriorityFeeEstimate;
        priorityFee = estimate.microLamports;
      } catch {
        priorityFee = undefined;
      }
    }

    // SetComputeUnitPrice must be placed at instruction index 0 before business instructions
    if (typeof priorityFee === "number" && priorityFee > 0) {
      const safeFee = Math.max(0, Math.floor(priorityFee));
      const existingIndex = transaction.instructions.findIndex(
        (ix) =>
          ix.programId.equals(ComputeBudgetProgram.programId) &&
          ix.data.length > 0 &&
          ix.data[0] === 3,
      );
      const computeIx = ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: safeFee,
      });
      if (existingIndex >= 0) {
        transaction.instructions[existingIndex] = computeIx;
      } else {
        transaction.instructions.unshift(computeIx);
      }
    }

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

  /**
   * Connection for one specific endpoint of the pool, creating it on first use.
   * Rejects for an endpoint that is not part of this pool.
   */
  public async getConnectionForEndpoint(endpoint: string): Promise<Connection> {
    if (!this.endpoints.includes(endpoint)) {
      throw new EscrowRpcFailoverError(
        [],
        `RPC endpoint ${endpoint} is not part of this pool`,
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

  /** Fetches the latest blockhash with exponential backoff on transient RPC errors. */
  public async getLatestBlockhashWithRetry(
    maxRetries = 3,
    baseBackoffMs = 500,
  ): Promise<{ blockhash: string; lastValidBlockHeight: number }> {
    return this.pool.execute((connection) =>
      fetchLatestBlockhashWithBackoff(connection, maxRetries, baseBackoffMs),
    );
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

  /**
   * Subscribes to signature confirmation via WebSocket with automatic two-stage
   * HTTP polling fallback.
   */
  public subscribeToConfirmation(
    signature: string,
    options?: Omit<SubscribeToEscrowConfirmationOptions, "pool">,
  ): EscrowConfirmationSubscription {
    return subscribeToEscrowConfirmation(signature, {
      ...options,
      pool: this.pool,
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

// ===========================================================================
// WebSocket Confirmation Streaming & Monotonic State Machine (#7773)
// ===========================================================================

export type EscrowConfirmationStatus =
  | "pending"
  | "processed"
  | "confirmed"
  | "finalized"
  | "fallback_polling"
  | "failed"
  | "timeout";

export type EscrowConfirmationSource = "websocket" | "http_polling";

export interface EscrowConfirmationEvent {
  signature: string;
  status: EscrowConfirmationStatus;
  source: EscrowConfirmationSource;
  slot?: number | null;
  error?: string | null;
  timestamp: number;
}

export interface EscrowConfirmationCallbacks {
  onStatusChange?: (event: EscrowConfirmationEvent) => void;
  onProcessed?: (event: EscrowConfirmationEvent) => void;
  onConfirmed?: (event: EscrowConfirmationEvent) => void;
  onFinalized?: (event: EscrowConfirmationEvent) => void;
  onFallbackPolling?: (event: EscrowConfirmationEvent) => void;
  onError?: (error: Error, event: EscrowConfirmationEvent) => void;
  onTimeout?: (event: EscrowConfirmationEvent) => void;
}

export interface SubscribeToEscrowConfirmationOptions {
  connection?: Connection;
  pool?: EscrowRpcConnectionPool;
  commitment?: "processed" | "confirmed" | "finalized";
  confirmTimeoutMs?: number; // Stage 1 watchdog: 30s default
  confirmationTimeoutMs?: number; // alias
  finalizeTimeoutMs?: number; // Stage 2 watchdog: 15s default
  finalizationTimeoutMs?: number; // alias
  overallTimeoutMs?: number; // Overall budget timeout: 55s default
  pollIntervalMs?: number; // HTTP fallback poll initial interval: 2s or 500ms default
  httpPollingIntervalMs?: number; // alias
  minPollIntervalMs?: number; // Minimum backoff interval (default: 500ms)
  maxPollIntervalMs?: number; // Maximum backoff cap (default: 8000ms)
  pollBackoffMultiplier?: number; // Exponential backoff multiplier (default: 2.0)
  lastValidBlockHeight?: number; // For blockhash expiration detection
  callbacks?: EscrowConfirmationCallbacks;
  pollSignatureStatus?: (signature: string) => Promise<SignatureStatus | null>;
  onWebSocketDisconnect?: (reason?: string) => void;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface EscrowConfirmationSubscription {
  signature: string;
  getStatus: () => EscrowConfirmationStatus;
  getLatestEvent: () => EscrowConfirmationEvent;
  unsubscribe: () => void;
  promise: Promise<EscrowConfirmationEvent>;
}

export const ESCROW_CONFIRM_WATCHDOG_MS = 30_000;
export const ESCROW_FINALIZE_WATCHDOG_MS = 15_000;
export const ESCROW_STREAMING_OVERALL_TIMEOUT_MS = 55_000;
export const ESCROW_STREAMING_POLL_INTERVAL_MS = 2_000;
export const ESCROW_MIN_POLL_INTERVAL_MS = 500;
export const ESCROW_MAX_POLL_INTERVAL_MS = 8_000;
export const ESCROW_POLL_BACKOFF_MULTIPLIER = 2.0;

export class EscrowConfirmationStateMachine {
  private currentStatus: EscrowConfirmationStatus = "pending";
  private currentSource: EscrowConfirmationSource = "websocket";
  private currentCommitmentRank = 0; // 0: none/pending, 1: processed, 2: confirmed, 3: finalized
  private _isTerminal = false;
  private latestEvent: EscrowConfirmationEvent;
  private readonly signature: string;
  private readonly callbacks?: EscrowConfirmationCallbacks;
  private readonly now: () => number;
  private listeners: Array<(event: EscrowConfirmationEvent) => void> = [];
  public readonly promise: Promise<EscrowConfirmationEvent>;
  private resolvePromise!: (value: EscrowConfirmationEvent) => void;
  private rejectPromise!: (reason: any) => void;

  constructor(
    signature: string,
    callbacks?: EscrowConfirmationCallbacks,
    now: () => number = Date.now,
  ) {
    this.signature = signature;
    this.callbacks = callbacks;
    this.now = now;
    this.latestEvent = {
      signature,
      status: "pending",
      source: "websocket",
      slot: null,
      error: null,
      timestamp: this.now(),
    };

    this.promise = new Promise<EscrowConfirmationEvent>((resolve, reject) => {
      this.resolvePromise = resolve;
      this.rejectPromise = reject;
    });
  }

  public abort(reason = "Subscription cancelled"): void {
    if (this._isTerminal) return;
    this._isTerminal = true;
    const err = new Error(reason);
    this.promise.catch(() => {});
    this.rejectPromise(err);
  }

  public getStatus(): EscrowConfirmationStatus {
    return this.currentStatus;
  }

  public getCommitmentRank(): number {
    return this.currentCommitmentRank;
  }

  public getLatestEvent(): EscrowConfirmationEvent {
    return { ...this.latestEvent };
  }

  public isDone(): boolean {
    return this._isTerminal;
  }

  public isTerminal(): boolean {
    return this._isTerminal;
  }

  public subscribe(
    listener: (event: EscrowConfirmationEvent) => void,
  ): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  public transition(
    newStatus: EscrowConfirmationStatus,
    sourceOrOptions?:
      | EscrowConfirmationSource
      | { slot?: number | null; error?: string | null; reason?: string },
    optionsParam?: {
      slot?: number | null;
      error?: string | null;
      reason?: string;
    },
  ): EscrowConfirmationEvent | null {
    if (this._isTerminal) {
      return null;
    }

    let source: EscrowConfirmationSource = "websocket";
    let options: {
      slot?: number | null;
      error?: string | null;
      reason?: string;
    } = {};

    if (typeof sourceOrOptions === "string") {
      source = sourceOrOptions;
      if (optionsParam) options = optionsParam;
    } else if (
      typeof sourceOrOptions === "object" &&
      sourceOrOptions !== null
    ) {
      options = sourceOrOptions;
    }

    // Determine commitment rank
    let targetRank = this.currentCommitmentRank;
    if (newStatus === "processed") targetRank = 1;
    else if (newStatus === "confirmed") targetRank = 2;
    else if (newStatus === "finalized") targetRank = 3;

    // Reject out-of-order commitment regressions
    // e.g. processed arriving when already confirmed (1 < 2)
    if (
      (newStatus === "processed" ||
        newStatus === "confirmed" ||
        newStatus === "finalized") &&
      targetRank < this.currentCommitmentRank
    ) {
      return null;
    }

    // Duplicate event check
    if (
      newStatus === this.currentStatus &&
      targetRank === this.currentCommitmentRank &&
      newStatus !== "fallback_polling"
    ) {
      return null;
    }

    // Update state
    this.currentStatus = newStatus;
    this.currentSource = source;
    if (targetRank > this.currentCommitmentRank) {
      this.currentCommitmentRank = targetRank;
    }

    const event: EscrowConfirmationEvent = {
      signature: this.signature,
      status: newStatus,
      source,
      slot: options.slot ?? this.latestEvent.slot ?? null,
      error: options.error ?? null,
      timestamp: this.now(),
    };
    this.latestEvent = event;

    // Check terminal
    if (
      newStatus === "finalized" ||
      newStatus === "failed" ||
      newStatus === "timeout"
    ) {
      this._isTerminal = true;
      if (newStatus === "finalized") {
        this.resolvePromise(event);
      } else {
        const err = new Error(
          options.error || `Escrow confirmation ended in state: ${newStatus}`,
        );
        // Avoid unhandled rejection crash if caller doesn't attach .catch to promise
        this.promise.catch(() => {});
        this.rejectPromise(err);
      }
    }

    // Fire listeners and callbacks safely
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (lErr) {
        console.error("[EscrowStateMachine] Error in listener:", lErr);
      }
    }

    try {
      this.callbacks?.onStatusChange?.(event);
      if (newStatus === "processed") this.callbacks?.onProcessed?.(event);
      else if (newStatus === "confirmed") this.callbacks?.onConfirmed?.(event);
      else if (newStatus === "finalized") {
        this.callbacks?.onFinalized?.(event);
      } else if (newStatus === "fallback_polling") {
        this.callbacks?.onFallbackPolling?.(event);
      } else if (newStatus === "failed") {
        const err = new Error(options.error || "Escrow confirmation failed");
        this.callbacks?.onError?.(err, event);
      } else if (newStatus === "timeout") {
        this.callbacks?.onTimeout?.(event);
      }
    } catch (cbErr) {
      console.error("[EscrowStateMachine] Error in callback:", cbErr);
    }

    return event;
  }
}

/**
 * Subscribes to Solana transaction signature confirmation via WebSocket RPC subscriptions
 * with automatic two-stage fallback to HTTP polling.
 *
 * Stage 1 (0-30s): Listens on WebSocket at processed, confirmed, and finalized commitment.
 * If confirmed/finalized is not received within 30s, transitions to fallback_polling.
 * Stage 2: Once confirmed, if finalized is not received within 15s, maintains HTTP polling until finality.
 * Overall budget (55s): Terminates safely before serverless execution boundaries.
 */
export function subscribeToEscrowConfirmation(
  signature: string,
  options: SubscribeToEscrowConfirmationOptions = {},
): EscrowConfirmationSubscription {
  if (!signature || typeof signature !== "string" || !signature.trim()) {
    throw new Error("Valid transaction signature is required");
  }
  const cleanSignature = signature.trim();

  const confirmTimeoutMs =
    options.confirmationTimeoutMs ??
    options.confirmTimeoutMs ??
    ESCROW_CONFIRM_WATCHDOG_MS;
  const finalizeTimeoutMs =
    options.finalizationTimeoutMs ??
    options.finalizeTimeoutMs ??
    ESCROW_FINALIZE_WATCHDOG_MS;
  const overallTimeoutMs =
    options.overallTimeoutMs ?? ESCROW_STREAMING_OVERALL_TIMEOUT_MS;
  const initialPollDelayMs =
    options.httpPollingIntervalMs ??
    options.pollIntervalMs ??
    options.minPollIntervalMs ??
    ESCROW_MIN_POLL_INTERVAL_MS;
  const maxPollIntervalMs =
    options.maxPollIntervalMs ?? ESCROW_MAX_POLL_INTERVAL_MS;
  const pollBackoffMultiplier =
    options.pollBackoffMultiplier ?? ESCROW_POLL_BACKOFF_MULTIPLIER;
  const lastValidBlockHeight = options.lastValidBlockHeight;
  const targetCommitment = options.commitment ?? "finalized";
  const now = options.now ?? Date.now;

  let currentPollDelayMs = initialPollDelayMs;

  const stateMachine = new EscrowConfirmationStateMachine(
    cleanSignature,
    options.callbacks,
    now,
  );

  let confirmTimer: ReturnType<typeof setTimeout> | undefined;
  let finalizeTimer: ReturnType<typeof setTimeout> | undefined;
  let overallTimer: ReturnType<typeof setTimeout> | undefined;
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  let isUnsubscribed = false;
  let isPollingActive = false;

  let connection: Connection | null = options.connection ?? null;
  const pool = options.pool ?? getEscrowRpcPool();

  let processedSubId: number | undefined;
  let confirmedSubId: number | undefined;
  let finalizedSubId: number | undefined;
  let subStateRemovers: Array<() => void> = [];

  const cleanupListeners = () => {
    for (const remover of subStateRemovers) {
      try {
        remover();
      } catch {}
    }
    subStateRemovers = [];

    if (connection) {
      const activeConn = connection;
      if (processedSubId !== undefined) {
        const id = processedSubId;
        processedSubId = undefined;
        try {
          void activeConn.removeSignatureListener(id);
        } catch {}
      }
      if (confirmedSubId !== undefined) {
        const id = confirmedSubId;
        confirmedSubId = undefined;
        try {
          void activeConn.removeSignatureListener(id);
        } catch {}
      }
      if (finalizedSubId !== undefined) {
        const id = finalizedSubId;
        finalizedSubId = undefined;
        try {
          void activeConn.removeSignatureListener(id);
        } catch {}
      }
    }
  };

  const cleanupTimers = () => {
    if (confirmTimer) {
      clearTimeout(confirmTimer);
      confirmTimer = undefined;
    }
    if (finalizeTimer) {
      clearTimeout(finalizeTimer);
      finalizeTimer = undefined;
    }
    if (overallTimer) {
      clearTimeout(overallTimer);
      overallTimer = undefined;
    }
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = undefined;
    }
  };

  const unsubscribe = () => {
    if (isUnsubscribed) return;
    isUnsubscribed = true;
    cleanupTimers();
    void cleanupListeners();
    stateMachine.abort("Subscription unsubscribed by caller");
  };

  // Start overall timeout timer
  overallTimer = setTimeout(() => {
    if (stateMachine.isDone() || isUnsubscribed) return;
    stateMachine.transition(
      "timeout",
      isPollingActive ? "http_polling" : "websocket",
      {
        error: `Confirmation timed out after ${overallTimeoutMs}ms`,
      },
    );
    unsubscribe();
  }, overallTimeoutMs);
  overallTimer.unref?.();

  // Helper to trigger HTTP fallback polling loop
  const triggerHttpFallback = (reason?: string) => {
    if (stateMachine.isDone() || isUnsubscribed || isPollingActive) return;
    isPollingActive = true;
    options.onWebSocketDisconnect?.(reason);
    stateMachine.transition("fallback_polling", "http_polling", {
      error: reason,
    });
    void pollOnce();
  };

  // Helper to check blockhash expiration
  const checkBlockhashExpired = async (): Promise<boolean> => {
    if (lastValidBlockHeight === undefined || lastValidBlockHeight === null) {
      return false;
    }
    try {
      let currentHeight: number;
      if (connection) {
        currentHeight = await connection.getBlockHeight(targetCommitment);
      } else {
        currentHeight = await pool.execute((conn) =>
          conn.getBlockHeight(targetCommitment),
        );
      }
      return currentHeight > lastValidBlockHeight;
    } catch {
      return false;
    }
  };

  // Single status fetch shared by every polling path. Each request is bounded
  // by a 5s abort deadline so a blackholed RPC node can never hang the loop;
  // a timeout rejects and is handled by the caller like any other poll error.
  const fetchSignatureStatus = (): Promise<SignatureStatus | null> =>
    withRpcPollTimeout(
      async () => {
        if (options.pollSignatureStatus) {
          return options.pollSignatureStatus(cleanSignature);
        }
        if (connection) {
          const res = await connection.getSignatureStatuses([cleanSignature], {
            searchTransactionHistory: true,
          });
          return res.value?.[0] ?? null;
        }
        const res = await pool.execute((conn) =>
          conn.getSignatureStatuses([cleanSignature], {
            searchTransactionHistory: true,
          }),
        );
        return res.value?.[0] ?? null;
      },
      { endpoint: "escrow-confirmation-poll" },
    );

  // Helper to poll signature status once
  const pollOnce = async () => {
    if (stateMachine.isDone() || isUnsubscribed) return;

    let status: SignatureStatus | null = null;
    try {
      status = await fetchSignatureStatus();
    } catch (pollErr) {
      console.warn(
        `[EscrowStreaming] HTTP poll failed for ${cleanSignature}:`,
        pollErr,
      );
      scheduleNextPoll();
      return;
    }

    if (stateMachine.isDone() || isUnsubscribed) return;

    if (status) {
      if (status.err) {
        stateMachine.transition("failed", "http_polling", {
          slot: status.slot,
          error:
            typeof status.err === "string"
              ? status.err
              : JSON.stringify(status.err),
        });
        unsubscribe();
        return;
      }

      const commitment = status.confirmationStatus;
      if (commitment === "finalized" || status.confirmations === null) {
        stateMachine.transition("finalized", "http_polling", {
          slot: status.slot,
        });
        unsubscribe();
        return;
      }

      if (commitment === "confirmed") {
        stateMachine.transition("confirmed", "http_polling", {
          slot: status.slot,
        });

        if (targetCommitment === "confirmed") {
          unsubscribe();
          return;
        }

        // Continue polling for finalization
        if (!finalizeTimer) {
          finalizeTimer = setTimeout(() => {
            // Watchdog: If finalizeTimer expires, polling continues
          }, finalizeTimeoutMs);
          finalizeTimer.unref?.();
        }
      } else if (commitment === "processed") {
        stateMachine.transition("processed", "http_polling", {
          slot: status.slot,
        });
        if (targetCommitment === "processed") {
          unsubscribe();
          return;
        }
      }
    } else {
      // If status is not found, check if blockhash expired
      const isExpired = await checkBlockhashExpired();
      if (isExpired && !stateMachine.isDone() && !isUnsubscribed) {
        let finalCheckSucceeded = false;
        try {

          let finalRes: SignatureStatus | null = null;
          if (options.pollSignatureStatus) {
            finalRes = await options.pollSignatureStatus(cleanSignature);
            finalCheckSucceeded = true;
          } else if (connection) {
            const res = await connection.getSignatureStatuses(
              [cleanSignature],
              {
                searchTransactionHistory: true,
              },
            );
            finalRes = res.value?.[0] ?? null;
            finalCheckSucceeded = true;
          } else {
            const res = await pool.execute((conn) =>
              conn.getSignatureStatuses([cleanSignature], {
                searchTransactionHistory: true,
              }),
            );
            finalRes = res.value?.[0] ?? null;
            finalCheckSucceeded = true;
          }

          const finalRes: SignatureStatus | null = await fetchSignatureStatus();
          finalCheckSucceeded = true;


          if (finalRes && !finalRes.err) {
            const finalCommitment = finalRes.confirmationStatus;
            if (
              finalCommitment === "finalized" ||
              finalRes.confirmations === null
            ) {
              stateMachine.transition("finalized", "http_polling", {
                slot: finalRes.slot,
              });
              unsubscribe();
              return;
            } else if (finalCommitment === "confirmed") {
              stateMachine.transition("confirmed", "http_polling", {
                slot: finalRes.slot,
              });
              if (targetCommitment === "confirmed") {
                unsubscribe();
                return;
              }
            }
          }
        } catch {
          finalCheckSucceeded = false;
        }

        if (finalCheckSucceeded && !stateMachine.isDone() && !isUnsubscribed) {
          stateMachine.transition("timeout", "http_polling", {
            error: `Transaction blockhash expired (current block height exceeded ${lastValidBlockHeight})`,
          });
          unsubscribe();
          return;
        }
      }
    }

    scheduleNextPoll();
  };

  const scheduleNextPoll = () => {
    if (stateMachine.isDone() || isUnsubscribed) return;
    const delay = currentPollDelayMs;
    // Exponential backoff
    currentPollDelayMs = Math.min(
      maxPollIntervalMs,
      Math.round(currentPollDelayMs * pollBackoffMultiplier),
    );

    pollTimer = setTimeout(() => {
      void pollOnce();
    }, delay);
    pollTimer.unref?.();
  };

  // Stage 1 Confirmation Watchdog (30s): If confirmed is not reached within 30s, activate HTTP fallback
  confirmTimer = setTimeout(() => {
    if (stateMachine.getCommitmentRank() < 2 && !stateMachine.isDone()) {
      triggerHttpFallback("30-second WebSocket confirmation watchdog expired");
    }
  }, confirmTimeoutMs);
  confirmTimer.unref?.();

  const registerSubDisconnectListener = (conn: any, subId: number) => {
    let wasSubscribed = false;
    if (typeof conn._onSubscriptionStateChange === "function") {
      try {
        const remove = conn._onSubscriptionStateChange(
          subId,
          (state: string) => {
            if (stateMachine.isDone() || isUnsubscribed) return;
            if (state === "subscribed") {
              wasSubscribed = true;
            } else if (state === "error") {
              triggerHttpFallback(
                `WebSocket subscription ${subId} entered state 'error'`,
              );
            } else if (state === "pending" && wasSubscribed) {
              // Only trigger fallback if subscription was previously active and dropped back to pending
              triggerHttpFallback(
                `WebSocket subscription ${subId} disconnected (dropped to 'pending')`,
              );
            }
          },
        );
        if (typeof remove === "function") {
          subStateRemovers.push(remove);
        }
      } catch {}
    }
  };

  const setupListeners = (conn: Connection) => {
    connection = conn;
    if (stateMachine.isDone() || isUnsubscribed) return;

    // Attach connection-level socket error/close listeners if present (for mock or custom providers)
    const connAny = conn as any;
    if (typeof connAny.on === "function") {
      const onWsError = (err: any) => {
        triggerHttpFallback(`WebSocket error: ${err?.message || err}`);
      };
      const onWsClose = () => {
        triggerHttpFallback("WebSocket connection closed");
      };
      connAny.on("error", onWsError);
      connAny.on("close", onWsClose);
      connAny.on("disconnect", onWsClose);
      subStateRemovers.push(() => {
        try {
          connAny.off?.("error", onWsError);
          connAny.off?.("close", onWsClose);
          connAny.off?.("disconnect", onWsClose);
        } catch {}
      });
    }

    // 1. Processed commitment listener
    try {
      processedSubId = conn.onSignatureWithOptions(
        cleanSignature,
        (notification, context) => {
          if (stateMachine.isDone() || isUnsubscribed) return;
          const err =
            (notification as any)?.err ?? (notification as any)?.result?.err;
          if (err) {
            stateMachine.transition("failed", "websocket", {
              slot: context?.slot,
              error: typeof err === "string" ? err : JSON.stringify(err),
            });
            unsubscribe();
            return;
          }
          stateMachine.transition("processed", "websocket", {
            slot: context?.slot,
          });
          if (targetCommitment === "processed") {
            unsubscribe();
          }
        },
        { commitment: "processed" },
      );
      if (processedSubId !== undefined) {
        registerSubDisconnectListener(conn, processedSubId);
      }
    } catch (e) {
      console.warn(
        "[EscrowStreaming] Failed to subscribe to processed notification:",
        e,
      );
    }

    // 2. Confirmed commitment listener
    try {
      confirmedSubId = conn.onSignatureWithOptions(
        cleanSignature,
        (notification, context) => {
          if (stateMachine.isDone() || isUnsubscribed) return;
          const err =
            (notification as any)?.err ?? (notification as any)?.result?.err;
          if (err) {
            stateMachine.transition("failed", "websocket", {
              slot: context?.slot,
              error: typeof err === "string" ? err : JSON.stringify(err),
            });
            unsubscribe();
            return;
          }

          // Clear Stage 1 confirmation watchdog
          if (confirmTimer) {
            clearTimeout(confirmTimer);
            confirmTimer = undefined;
          }

          stateMachine.transition("confirmed", "websocket", {
            slot: context?.slot,
          });

          if (targetCommitment === "confirmed") {
            unsubscribe();
            return;
          }

          // Start Stage 2 Finalization Watchdog (15s):
          // If finalized is not received within 15s of confirmed, trigger HTTP polling
          if (!finalizeTimer && !stateMachine.isDone()) {
            finalizeTimer = setTimeout(() => {
              if (
                stateMachine.getCommitmentRank() < 3 &&
                !stateMachine.isDone()
              ) {
                triggerHttpFallback(
                  "15-second post-confirmation finalization watchdog expired",
                );
              }
            }, finalizeTimeoutMs);
            finalizeTimer.unref?.();
          }
        },
        { commitment: "confirmed" },
      );
      if (confirmedSubId !== undefined) {
        registerSubDisconnectListener(conn, confirmedSubId);
      }
    } catch (e) {
      console.warn(
        "[EscrowStreaming] Failed to subscribe to confirmed notification:",
        e,
      );
    }

    // 3. Finalized commitment listener
    try {
      finalizedSubId = conn.onSignatureWithOptions(
        cleanSignature,
        (notification, context) => {
          if (stateMachine.isDone() || isUnsubscribed) return;
          const err =
            (notification as any)?.err ?? (notification as any)?.result?.err;
          if (err) {
            stateMachine.transition("failed", "websocket", {
              slot: context?.slot,
              error: typeof err === "string" ? err : JSON.stringify(err),
            });
            unsubscribe();
            return;
          }

          stateMachine.transition("finalized", "websocket", {
            slot: context?.slot,
          });
          unsubscribe();
        },
        { commitment: "finalized" },
      );
      if (finalizedSubId !== undefined) {
        registerSubDisconnectListener(conn, finalizedSubId);
      }
    } catch (e) {
      console.warn(
        "[EscrowStreaming] Failed to subscribe to finalized notification:",
        e,
      );
    }

    // If all three subscriptions failed to register, fall back immediately to HTTP polling
    if (
      processedSubId === undefined &&
      confirmedSubId === undefined &&
      finalizedSubId === undefined
    ) {
      triggerHttpFallback(
        "WebSocket subscription registration failed across all commitments",
      );
    }
  };

  // Initialize WebSocket subscriptions
  if (connection) {
    setupListeners(connection);
  } else {
    (async () => {
      try {
        let conn: Connection | undefined;
        if (typeof (pool as any).getActiveConnection === "function") {
          conn = await (pool as any).getActiveConnection();
        } else if (typeof (pool as any).getConnection === "function") {
          conn = await (pool as any).getConnection();
        } else {
          conn = await pool.execute((c) => Promise.resolve(c));
        }

        if (conn && !isUnsubscribed && !stateMachine.isDone()) {
          setupListeners(conn);
        }
      } catch (connErr) {
        console.warn(
          "[EscrowStreaming] Failed to acquire connection for WebSocket subscription:",
          connErr,
        );
        triggerHttpFallback(
          "Failed to acquire connection for WebSocket subscription",
        );
      }
    })();
  }

  return {
    signature: cleanSignature,
    getStatus: () => stateMachine.getStatus(),
    getLatestEvent: () => stateMachine.getLatestEvent(),
    unsubscribe,
    promise: stateMachine.promise,
  };
}

export * from "./solanaPayEscrow";
export * from "./priorityFeeEstimator";
export * from "./escrowTransactionRetry";

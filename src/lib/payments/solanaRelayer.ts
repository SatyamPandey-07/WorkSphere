import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  Transaction,
} from "@solana/web3.js";
import {
  DEFAULT_MAX_RELAY_FEE_LAMPORTS,
  validateRelayFeeLamports,
} from "@/lib/payments/solanaPay";

const MAX_SERIALIZED_TRANSACTION_BYTES = 1_232;

export const DEFAULT_PRIORITY_FEE_PERCENTILE = 75;
export const DEFAULT_MIN_PRIORITY_FEE_MICRO_LAMPORTS = 1_000;
export const DEFAULT_MAX_PRIORITY_FEE_MICRO_LAMPORTS = 1_000_000;

export interface RelayedSolanaTransaction {
  signature: string;
  feeLamports: number;
  priorityFeeMicroLamports?: number;
}

export interface DynamicPriorityFeeOptions {
  percentile?: number;
  minFee?: number;
  maxFee?: number;
}

export interface PriorityFeeBounds {
  minFee: number;
  maxFee: number;
  percentile: number;
}

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not configured`);
  }
  return value;
}

function getRelayerKeypair(): Keypair {
  let secretKey: unknown;
  try {
    secretKey = JSON.parse(getRequiredEnv("SOLANA_RELAYER_PRIVATE_KEY"));
  } catch {
    throw new Error("SOLANA_RELAYER_PRIVATE_KEY must be a JSON array");
  }

  if (
    !Array.isArray(secretKey) ||
    secretKey.length !== 64 ||
    secretKey.some(
      (value) => !Number.isInteger(value) || value < 0 || value > 255,
    )
  ) {
    throw new Error("SOLANA_RELAYER_PRIVATE_KEY must contain 64 bytes");
  }

  return Keypair.fromSecretKey(Uint8Array.from(secretKey));
}

function decodeTransaction(serializedTransaction: string): Transaction {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(serializedTransaction)) {
    throw new Error("Transaction must be base64 encoded");
  }

  const bytes = Buffer.from(serializedTransaction, "base64");
  if (bytes.length === 0 || bytes.length > MAX_SERIALIZED_TRANSACTION_BYTES) {
    throw new Error("Transaction has an invalid size");
  }

  return Transaction.from(bytes);
}

/**
 * Async FIFO Mutex for single-flight serialization of relayer signing and submissions (#5741).
 */
export class RelayerMutex {
  private queue: Array<() => void> = [];
  private locked = false;

  public async acquire(): Promise<() => void> {
    if (!this.locked) {
      this.locked = true;
      return () => this.release();
    }

    return new Promise<() => void>((resolve) => {
      this.queue.push(() => {
        this.locked = true;
        resolve(() => this.release());
      });
    });
  }

  private release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.locked = false;
    }
  }

  public isLocked(): boolean {
    return this.locked;
  }

  public getQueueLength(): number {
    return this.queue.length;
  }
}

export const relayerMutex = new RelayerMutex();

/**
 * Cache for the latest valid blockhash with automated refresh buffer (30 seconds) (#5741).
 */
export interface CachedBlockhash {
  blockhash: string;
  lastValidBlockHeight?: number;
  fetchedAt: number;
}

export const BLOCKHASH_CACHE_TTL_MS = 30_000; // 30 seconds buffer
let cachedBlockhash: CachedBlockhash | null = null;

export function getCachedBlockhash(): CachedBlockhash | null {
  return cachedBlockhash;
}

export function clearBlockhashCache(): void {
  cachedBlockhash = null;
}

export async function getLatestBlockhashWithCache(
  connection: Connection,
  forceRefresh = false,
  ttlMs = BLOCKHASH_CACHE_TTL_MS,
): Promise<string> {
  const now = Date.now();
  if (
    !forceRefresh &&
    cachedBlockhash &&
    now - cachedBlockhash.fetchedAt < ttlMs
  ) {
    return cachedBlockhash.blockhash;
  }

  const latest = await connection.getLatestBlockhash("confirmed");
  cachedBlockhash = {
    blockhash: latest.blockhash,
    lastValidBlockHeight: latest.lastValidBlockHeight,
    fetchedAt: now,
  };
  return cachedBlockhash.blockhash;
}

/**
 * Calculates the percentile value from an array of prioritization fee entries.
 * Defaults to the 75th percentile to ensure instant transaction landing during congestion (#5774).
 */
export function calculatePriorityFeePercentile(
  fees: Array<number | { prioritizationFee: number }>,
  percentile = DEFAULT_PRIORITY_FEE_PERCENTILE,
): number {
  if (!fees || fees.length === 0) {
    return 0;
  }

  const rawFees = fees
    .map((item) => (typeof item === "number" ? item : item?.prioritizationFee))
    .filter(
      (val): val is number =>
        typeof val === "number" && !isNaN(val) && isFinite(val) && val >= 0,
    );

  if (rawFees.length === 0) {
    return 0;
  }

  const sorted = [...rawFees].sort((a, b) => a - b);
  const targetPercentile = Math.max(0, Math.min(100, percentile));
  const index = Math.max(
    0,
    Math.min(
      Math.ceil((targetPercentile / 100) * sorted.length) - 1,
      sorted.length - 1,
    ),
  );

  return sorted[index];
}

/**
 * Clamps the computed priority fee within configured minimum and maximum bounds.
 */
export function clampPriorityFee(
  feeMicroLamports: number,
  minFee: number = DEFAULT_MIN_PRIORITY_FEE_MICRO_LAMPORTS,
  maxFee: number = DEFAULT_MAX_PRIORITY_FEE_MICRO_LAMPORTS,
): number {
  const safeMin = Math.max(0, minFee);
  const safeMax = Math.max(safeMin, maxFee);

  if (feeMicroLamports < safeMin) {
    return safeMin;
  }
  if (feeMicroLamports > safeMax) {
    return safeMax;
  }
  return feeMicroLamports;
}

/**
 * Resolves current priority fee bounds from environment variables or defaults.
 */
export function getPriorityFeeBounds(): PriorityFeeBounds {
  const envMin = process.env.SOLANA_MIN_PRIORITY_FEE_MICRO_LAMPORTS;
  const envMax = process.env.SOLANA_MAX_PRIORITY_FEE_MICRO_LAMPORTS;
  const envPercentile = process.env.SOLANA_PRIORITY_FEE_PERCENTILE;

  const minFee =
    envMin !== undefined && !isNaN(Number(envMin))
      ? Math.max(0, Number(envMin))
      : DEFAULT_MIN_PRIORITY_FEE_MICRO_LAMPORTS;

  const maxFee =
    envMax !== undefined && !isNaN(Number(envMax))
      ? Math.max(minFee, Number(envMax))
      : DEFAULT_MAX_PRIORITY_FEE_MICRO_LAMPORTS;

  const percentile =
    envPercentile !== undefined && !isNaN(Number(envPercentile))
      ? Math.max(0, Math.min(100, Number(envPercentile)))
      : DEFAULT_PRIORITY_FEE_PERCENTILE;

  return { minFee, maxFee, percentile };
}

/**
 * Queries getRecentPrioritizationFees from the Solana RPC and calculates
 * the priority fee based on network congestion.
 */
export async function getDynamicPriorityFee(
  connection: Connection,
  lockedWritableAccounts?: PublicKey[],
  options?: DynamicPriorityFeeOptions,
): Promise<number> {
  const bounds = getPriorityFeeBounds();
  const percentile = options?.percentile ?? bounds.percentile;
  const minFee = options?.minFee ?? bounds.minFee;
  const maxFee = options?.maxFee ?? bounds.maxFee;

  try {
    const recentFees = await connection.getRecentPrioritizationFees(
      lockedWritableAccounts && lockedWritableAccounts.length > 0
        ? lockedWritableAccounts
        : undefined,
    );

    const calculated = calculatePriorityFeePercentile(recentFees, percentile);
    return clampPriorityFee(calculated, minFee, maxFee);
  } catch (error) {
    console.warn(
      "Failed to fetch recent prioritization fees from RPC, falling back to min priority fee:",
      error,
    );
    return minFee;
  }
}

/**
 * Injects or updates a ComputeBudgetProgram.setComputeUnitPrice instruction
 * in the transaction to dynamically adjust the prioritization fee (#5774).
 */
export function injectPriorityFeeInstruction(
  transaction: Transaction,
  microLamports: number,
): Transaction {
  const priorityFeeIx = ComputeBudgetProgram.setComputeUnitPrice({
    microLamports,
  });

  // Check if a setComputeUnitPrice instruction already exists (discriminator 3)
  const existingIndex = transaction.instructions.findIndex(
    (ix) =>
      ix.programId.equals(ComputeBudgetProgram.programId) &&
      ix.data.length > 0 &&
      ix.data[0] === 3,
  );

  if (existingIndex >= 0) {
    transaction.instructions[existingIndex] = priorityFeeIx;
  } else {
    transaction.add(priorityFeeIx);
  }

  return transaction;
}

export async function relayGaslessUsdcTransaction(
  serializedTransaction: string,
  options?: DynamicPriorityFeeOptions,
): Promise<RelayedSolanaTransaction> {
  const releaseLock = await relayerMutex.acquire();

  try {
    const relayer = getRelayerKeypair();
    const transaction = decodeTransaction(serializedTransaction);

    if (
      !transaction.feePayer ||
      !transaction.feePayer.equals(relayer.publicKey)
    ) {
      throw new Error("Transaction fee payer must be the configured relayer");
    }

    const hasUserSignature = transaction.signatures.some(
      ({ publicKey, signature }) =>
        !publicKey.equals(relayer.publicKey) && signature !== null,
    );
    if (!hasUserSignature) {
      throw new Error("Transaction must include a user signature");
    }

    const connection = new Connection(
      getRequiredEnv("SOLANA_RPC_URL"),
      "confirmed",
    );

    // If transaction doesn't have a recent blockhash or needs a valid cached blockhash, ensure it is set (#5741)
    if (!transaction.recentBlockhash) {
      transaction.recentBlockhash = await getLatestBlockhashWithCache(connection);
    }

    // Extract writable accounts to target congestion hotspot accounts
    const writableAccounts = transaction.instructions
      .flatMap((ix) => ix.keys)
      .filter((meta) => meta.isWritable)
      .map((meta) => meta.pubkey);

    const priorityFeeMicroLamports = await getDynamicPriorityFee(
      connection,
      writableAccounts,
      options,
    );

    injectPriorityFeeInstruction(transaction, priorityFeeMicroLamports);

    const feeResponse = await connection.getFeeForMessage(
      transaction.compileMessage(),
      "confirmed",
    );
    if (feeResponse.value === null) {
      throw new Error("Unable to estimate transaction fee");
    }

    const maxFeeLamports = Number(
      process.env.SOLANA_MAX_RELAY_FEE_LAMPORTS ??
        DEFAULT_MAX_RELAY_FEE_LAMPORTS,
    );
    const feeLamports = validateRelayFeeLamports(
      feeResponse.value,
      maxFeeLamports,
    );

    transaction.partialSign(relayer);
    const serialized = transaction.serialize({
      requireAllSignatures: true,
      verifySignatures: false,
    });
    const signature = await connection.sendRawTransaction(serialized, {
      skipPreflight: false,
      maxRetries: 3,
    });

    return { signature, feeLamports, priorityFeeMicroLamports };
  } finally {
    releaseLock();
  }
}

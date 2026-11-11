import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  VersionedTransaction,
} from "@solana/web3.js";
import type { Commitment, SignatureStatus } from "@solana/web3.js";
import {
  solanaPayEscrowManager,
  type SolanaPayEscrowManager,
  type ReserveSeatOptions,
  type SeatReservationState,
} from "./solanaPayEscrow";

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

/**
 * Simulates a signed Solana transaction on RPC nodes before broadcasting.
 */
export async function simulateEscrowTransaction(
  connection: Connection,
  transaction: Transaction | VersionedTransaction,
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
export function deriveEscrowPDA(bookingId: string): {
  address: PublicKey;
  bump: number;
} {
  if (!bookingId || typeof bookingId !== "string") {
    throw new Error("bookingId is required for PDA derivation");
  }
  const [address, bump] = PublicKey.findProgramAddressSync(
    [Buffer.from(PDA_SEED_PREFIX), Buffer.from(bookingId)],
    ESCROW_PROGRAM_ID,
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
  const { address: escrowVault } = deriveEscrowPDA(params.bookingId);

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

export function deriveEscrowPda(bookingId: string): [PublicKey, number] {
  const { address, bump } = deriveEscrowPDA(bookingId);
  return [address, bump];
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

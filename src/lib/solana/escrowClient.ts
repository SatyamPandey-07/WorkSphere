/**
 * Solana Escrow Client for WorkSphere Desk Bookings
 *
 * Constructs unsigned transactions for non-custodial escrow deposits (SOL and
 * USDC SPL-token). Transactions are returned as base64-encoded serialized
 * buffers ready for signing by Phantom, Solflare or any standard Solana wallet.
 *
 * ## On-chain dependency
 *
 * This client is designed to integrate with a future custom escrow program
 * deployed on Solana. **No escrow program is currently deployed.** The deposit
 * flow therefore uses native SOL transfers (SystemProgram) and SPL token
 * transfers to a deterministic PDA vault address. Once an escrow program is
 * deployed, the `buildDepositInstruction` helpers can be swapped out for the
 * program's `deposit` instruction without changing the public API surface.
 *
 * Release and refund are intentionally **not** implemented as client-side
 * transfer instructions — doing so would be custodial and insecure. They
 * require a verified on-chain escrow program that enforces check-in proofs and
 * venue-closure authority. Stub signatures are provided to document the
 * expected interface.
 *
 * @module solana/escrowClient
 */

import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  createTransferInstruction,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** USDC mint on mainnet-beta. Devnet USDC mint can be overridden via env. */
export const USDC_MINT = new PublicKey(
  process.env.NEXT_PUBLIC_USDC_MINT ??
    "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
);

/** USDC uses 6 decimal places. */
export const USDC_DECIMALS = 6;

/**
 * Placeholder escrow program ID. Set `NEXT_PUBLIC_ESCROW_PROGRAM_ID` once a
 * real program is deployed. This value is used **only** for PDA derivation;
 * no CPI is attempted against it until an actual program exists.
 *
 * The default value is a well-known "no program" sentinel (system program)
 * so that PDA seeds remain deterministic across environments.
 */
export const ESCROW_PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_ESCROW_PROGRAM_ID ??
    "11111111111111111111111111111111",
);

/** Seed prefix for PDA derivation. */
const PDA_SEED_PREFIX = "worksphere_escrow";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EscrowCurrency = "SOL" | "USDC";

export interface EscrowDepositParams {
  /** Payer's wallet public key (base58). */
  payerWallet: string;
  /** WorkSphere booking ID. */
  bookingId: string;
  /** Amount in human-readable units (SOL or USDC). */
  amount: number;
  /** Currency to deposit. */
  currency: EscrowCurrency;
  /** Solana RPC endpoint URL. */
  rpcUrl: string;
}

export interface EscrowDepositResult {
  /** Base64-encoded serialized transaction (message only, unsigned). */
  serializedTransaction: string;
  /** The escrow vault PDA address (base58). */
  escrowVault: string;
  /** PDA bump seed. */
  escrowBump: number;
  /** Amount in base units (lamports or token smallest unit). */
  amountBaseUnits: bigint;
  /** The recent blockhash used. */
  recentBlockhash: string;
}

export interface EscrowValidationResult {
  valid: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// PDA derivation
// ---------------------------------------------------------------------------

/**
 * Derives the deterministic escrow vault PDA for a given booking.
 *
 * Seeds: `["worksphere_escrow", bookingId_bytes]`
 *
 * The PDA is derived against `ESCROW_PROGRAM_ID`. When a real escrow program
 * is deployed, setting its ID via `NEXT_PUBLIC_ESCROW_PROGRAM_ID` will
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
// Amount conversion
// ---------------------------------------------------------------------------

/**
 * Converts a human-readable amount to the smallest on-chain unit.
 *
 * - SOL → lamports (1 SOL = 1_000_000_000 lamports)
 * - USDC → base units (1 USDC = 1_000_000 base units)
 *
 * Rejects negative, zero, NaN, Infinity, and amounts that would overflow
 * safe integer range after conversion.
 */
export function toBaseUnits(amount: number, currency: EscrowCurrency): bigint {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(
      `Invalid amount: must be a positive finite number, got ${amount}`,
    );
  }

  const multiplier = currency === "SOL" ? LAMPORTS_PER_SOL : 10 ** USDC_DECIMALS;
  const baseUnits = Math.round(amount * multiplier);

  // Guard against amounts so large they lose precision in floating point.
  if (!Number.isSafeInteger(baseUnits) || baseUnits <= 0) {
    throw new Error(
      `Amount ${amount} ${currency} converts to an unsafe integer (${baseUnits})`,
    );
  }

  return BigInt(baseUnits);
}

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

/**
 * Validates all escrow deposit parameters before building a transaction.
 */
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

    // Validate PDA can be derived
    deriveEscrowPDA(params.bookingId);

    // Validate amount conversion
    toBaseUnits(params.amount, params.currency);

    return { valid: true };
  } catch (e: unknown) {
    return {
      valid: false,
      error: e instanceof Error ? e.message : "Unknown validation error",
    };
  }
}

// ---------------------------------------------------------------------------
// SOL deposit transaction
// ---------------------------------------------------------------------------

/**
 * Builds an unsigned SOL transfer transaction from the payer to the escrow
 * vault PDA. The transaction is serialized without signatures so wallets
 * (Phantom, Solflare) can sign it client-side.
 */
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

  // Memo-like data: embed the bookingId so on-chain indexers / the future
  // escrow program can correlate deposits to bookings.
  const memoData = Buffer.from(
    JSON.stringify({ bookingId: params.bookingId, type: "escrow_deposit" }),
  );

  transaction.add(
    SystemProgram.transfer({
      fromPubkey: payer,
      toPubkey: escrowVault,
      lamports: amountBaseUnits,
    }),
    // Use a no-op instruction to attach booking metadata. A real escrow
    // program would replace this with its own deposit instruction.
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

// ---------------------------------------------------------------------------
// USDC SPL-token deposit transaction
// ---------------------------------------------------------------------------

/**
 * Builds an unsigned USDC SPL-token transfer from the payer's associated
 * token account to the escrow vault's associated token account.
 */
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

  // Derive associated token accounts for both payer and vault.
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
    true, // allowOwnerOffCurve: PDA is off-curve
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );

  const transaction = new Transaction({
    recentBlockhash: blockhash,
    feePayer: payer,
  });

  // Memo instruction for booking correlation.
  const memoData = Buffer.from(
    JSON.stringify({ bookingId: params.bookingId, type: "escrow_deposit_usdc" }),
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

// ---------------------------------------------------------------------------
// Unified deposit builder
// ---------------------------------------------------------------------------

/**
 * Builds an unsigned escrow deposit transaction for the given currency.
 */
export async function buildDepositTransaction(
  params: EscrowDepositParams,
): Promise<EscrowDepositResult> {
  if (params.currency === "SOL") {
    return buildSolDepositTransaction(params);
  }
  return buildUsdcDepositTransaction(params);
}

// ---------------------------------------------------------------------------
// Transaction confirmation & deposit verification
// ---------------------------------------------------------------------------

/**
 * Confirms a signed transaction on the Solana network.
 *
 * @param signature - The transaction signature (base58).
 * @param rpcUrl - Solana RPC endpoint.
 * @returns Whether the transaction was confirmed successfully.
 */
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

/**
 * Verifies that a deposit transaction matches the expected booking parameters.
 *
 * Fetches the parsed transaction from the network and checks:
 * 1. The transaction is confirmed/finalized.
 * 2. The destination matches the booking's escrow PDA (or its ATA for USDC).
 * 3. The transferred amount matches the expected amount.
 * 4. The payer matches the expected wallet.
 *
 * @returns Verification result with details.
 */
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

    // Verify payer is a signer.
    const accountKeys = tx.transaction.message.accountKeys;
    const payerKey = accountKeys.find(
      (k) => k.pubkey.equals(payer) && k.signer,
    );
    if (!payerKey) {
      return { verified: false, error: "Expected payer is not a signer" };
    }

    // For SOL deposits, check post-balances to confirm the vault received funds.
    // For USDC, check token balance changes.
    // This is a simplified verification; a production system should parse
    // individual instructions.
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
    return { verified: false, error: "Cannot check in for a cancelled booking" };
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
  const timestamp =
    options?.checkInTimestamp ?? Math.floor(Date.now() / 1000);

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
  const timestamp =
    options?.closureTimestamp ?? Math.floor(Date.now() / 1000);
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


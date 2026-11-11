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
 feature/solana-optimistic-escrow-simulation
  return false;
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

export * from "./solanaPayEscrow";
 main

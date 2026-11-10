import {
  PublicKey,
  TransactionInstruction,
  Transaction,
  SystemProgram,
} from "@solana/web3.js";

// Program ID configuration
export const ESCROW_PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_ESCROW_PROGRAM_ID || "11111111111111111111111111111111"
);

export interface EscrowAccountData {
  escrowId: string;
  bookingId: string;
  userPublicKey: string;
  venuePublicKey: string;
  amount: bigint;
  status: "DEPOSITED" | "REFUND_PENDING" | "REFUNDED" | "RELEASED";
}

export interface BuildRefundTransactionParams {
  bookingId: string;
  userPublicKey: string;
  vaultPda: string;
  recentBlockhash: string;
}

/**
 * Derives the Program Derived Address (PDA) for a booking escrow vault.
 */
export function deriveEscrowPda(bookingId: string): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("escrow"), Buffer.from(bookingId)],
    ESCROW_PROGRAM_ID
  );
}

/**
 * Constructs an unsigned refund transaction instruction referencing the PDA vault authority.
 * Non-custodial: Requires zero private keys.
 */
export function buildRefundInstruction(
  bookingId: string,
  userPubKeyStr: string,
  vaultPdaStr: string
): TransactionInstruction {
  const userPublicKey = new PublicKey(userPubKeyStr);
  const vaultPda = new PublicKey(vaultPdaStr);

  // Instruction Discriminator / Identifier for Refund
  const dataBuffer = Buffer.concat([
    Buffer.from([1]), // 1 = Refund Instruction Discriminator
    Buffer.from(bookingId),
  ]);

  return new TransactionInstruction({
    keys: [
      { pubkey: vaultPda, isSigner: false, isWritable: true },
      { pubkey: userPublicKey, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: ESCROW_PROGRAM_ID,
    data: dataBuffer,
  });
}

/**
 * Builds a complete unsigned transaction serialized for client-side wallet signing.
 */
export async function buildRefundTransaction({
  bookingId,
  userPublicKey,
  vaultPda,
  recentBlockhash,
}: BuildRefundTransactionParams): Promise<string> {
  const refundInstruction = buildRefundInstruction(
    bookingId,
    userPublicKey,
    vaultPda
  );

  const transaction = new Transaction();
  transaction.recentBlockhash = recentBlockhash;
  transaction.feePayer = new PublicKey(userPublicKey);
  transaction.add(refundInstruction);

  // Serialize unsigned transaction for wallet approval
  return transaction
    .serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    })
    .toString("base64");
}

/**
 * Verifies if the booking has exceeded the 24-hour grace window without check-in.
 */
export function isEscrowExpired(
  bookingDate: Date,
  gracePeriodHours: number = 24
): boolean {
  const now = new Date().getTime();
  const expiryTime = new Date(bookingDate).getTime() + gracePeriodHours * 60 * 60 * 1000;
  return now > expiryTime;
}
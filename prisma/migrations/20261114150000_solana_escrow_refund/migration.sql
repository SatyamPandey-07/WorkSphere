-- Durable Solana escrow holds and idempotent refund bookkeeping (#7740).
CREATE TYPE "SolanaEscrowStatus" AS ENUM (
  'PENDING',
  'REFUND_PENDING',
  'REFUNDED',
  'RELEASED',
  'FAILED'
);

CREATE TABLE "SolanaEscrow" (
  "id"                TEXT NOT NULL,
  "bookingId"         TEXT NOT NULL,
  "depositorWallet"   TEXT NOT NULL,
  "amountLamports"    BIGINT NOT NULL,
  "currency"          TEXT NOT NULL DEFAULT 'SOL',
  "status"            "SolanaEscrowStatus" NOT NULL DEFAULT 'PENDING',
  "holdExpiresAt"     TIMESTAMP(3) NOT NULL,
  "refundTxSignature" TEXT,
  "refundAttemptedAt" TIMESTAMP(3),
  "refundedAt"        TIMESTAMP(3),
  "lastRefundError"   TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SolanaEscrow_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SolanaEscrow_bookingId_key"
  ON "SolanaEscrow"("bookingId");
CREATE INDEX "SolanaEscrow_status_holdExpiresAt_idx"
  ON "SolanaEscrow"("status", "holdExpiresAt");
CREATE INDEX "SolanaEscrow_status_refundAttemptedAt_idx"
  ON "SolanaEscrow"("status", "refundAttemptedAt");

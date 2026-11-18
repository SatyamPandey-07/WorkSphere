-- Add depositTxSignature to SolanaEscrow for optimistic signature streaming (#7773)
ALTER TABLE "SolanaEscrow" ADD COLUMN "depositTxSignature" TEXT;

CREATE UNIQUE INDEX "SolanaEscrow_depositTxSignature_key"
  ON "SolanaEscrow"("depositTxSignature");

-- CreateEnum
CREATE TYPE "BarterAgreementState" AS ENUM ('PROPOSED', 'ACCEPTED', 'IN_PROGRESS', 'COMPLETED', 'SETTLED', 'CANCELLED');

-- CreateTable
CREATE TABLE "BarterAgreement" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "receiverId" TEXT NOT NULL,
    "skillOffered" TEXT NOT NULL,
    "skillRequested" TEXT NOT NULL,
    "amountMinutes" INTEGER NOT NULL,
    "state" "BarterAgreementState" NOT NULL DEFAULT 'PROPOSED',
    "providerPubKey" TEXT NOT NULL,
    "receiverPubKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BarterAgreement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimebankSettlement" (
    "id" TEXT NOT NULL,
    "agreementId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "receiverId" TEXT NOT NULL,
    "amountMinutes" INTEGER NOT NULL,
    "providerSig" TEXT NOT NULL,
    "receiverSig" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "settledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TimebankSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TimebankSettlement_agreementId_key" ON "TimebankSettlement"("agreementId");

-- CreateIndex
CREATE INDEX "BarterAgreement_providerId_idx" ON "BarterAgreement"("providerId");

-- CreateIndex
CREATE INDEX "BarterAgreement_receiverId_idx" ON "BarterAgreement"("receiverId");

-- CreateIndex
CREATE INDEX "BarterAgreement_state_idx" ON "BarterAgreement"("state");

-- CreateIndex
CREATE INDEX "TimebankSettlement_providerId_idx" ON "TimebankSettlement"("providerId");

-- CreateIndex
CREATE INDEX "TimebankSettlement_receiverId_idx" ON "TimebankSettlement"("receiverId");

-- AddForeignKey
ALTER TABLE "TimebankSettlement" ADD CONSTRAINT "TimebankSettlement_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "BarterAgreement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

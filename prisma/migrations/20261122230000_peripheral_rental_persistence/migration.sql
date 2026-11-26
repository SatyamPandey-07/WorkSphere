-- CreateEnum
CREATE TYPE "PeripheralRentalStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "PeripheralRental" (
    "id" TEXT NOT NULL,
    "rentalId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "lockerBayNumber" INTEGER NOT NULL,
    "unlockPin" TEXT NOT NULL,
    "depositAmount" DOUBLE PRECISION NOT NULL,
    "hourlyRate" DOUBLE PRECISION NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endTime" TIMESTAMP(3),
    "totalCostUsd" DOUBLE PRECISION,
    "status" "PeripheralRentalStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PeripheralRental_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PeripheralRental_rentalId_key" ON "PeripheralRental"("rentalId");

-- CreateIndex
CREATE INDEX "PeripheralRental_userId_idx" ON "PeripheralRental"("userId");

-- CreateIndex
CREATE INDEX "PeripheralRental_itemId_idx" ON "PeripheralRental"("itemId");

-- CreateIndex
CREATE INDEX "PeripheralRental_venueId_idx" ON "PeripheralRental"("venueId");

-- CreateIndex
CREATE INDEX "PeripheralRental_status_idx" ON "PeripheralRental"("status");

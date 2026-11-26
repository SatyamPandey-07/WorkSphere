-- CreateEnum
CREATE TYPE "CafeOrderStatus" AS ENUM ('received', 'brewing', 'ready_for_pickup', 'completed', 'cancelled');

-- CreateTable
CREATE TABLE "CafeOrder" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "venueName" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "deskNumber" TEXT,
    "items" JSONB NOT NULL,
    "subtotal" DOUBLE PRECISION NOT NULL,
    "tax" DOUBLE PRECISION NOT NULL,
    "total" DOUBLE PRECISION NOT NULL,
    "status" "CafeOrderStatus" NOT NULL DEFAULT 'received',
    "pickupCode" TEXT NOT NULL,
    "pickupToken" TEXT NOT NULL,
    "estimatedReadyTime" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CafeOrder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CafeOrder_userId_idx" ON "CafeOrder"("userId");

-- CreateIndex
CREATE INDEX "CafeOrder_venueId_idx" ON "CafeOrder"("venueId");

-- CreateIndex
CREATE INDEX "CafeOrder_status_idx" ON "CafeOrder"("status");

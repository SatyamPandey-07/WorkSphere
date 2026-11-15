-- CreateTable
CREATE TABLE "VenueCheckInNullifier" (
    "id" TEXT NOT NULL,
    "nullifierHash" TEXT NOT NULL,
    "epoch" INTEGER NOT NULL,
    "venueId" TEXT NOT NULL,
    "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VenueCheckInNullifier_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VenueCheckInNullifier_nullifierHash_epoch_key" ON "VenueCheckInNullifier"("nullifierHash", "epoch");

-- CreateIndex
CREATE INDEX "VenueCheckInNullifier_epoch_idx" ON "VenueCheckInNullifier"("epoch");

-- CreateIndex
CREATE INDEX "VenueCheckInNullifier_venueId_idx" ON "VenueCheckInNullifier"("venueId");

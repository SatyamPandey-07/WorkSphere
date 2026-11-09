-- Brings the migration history back in line with schema.prisma.
--
-- These objects were added to the schema without a migration, so databases
-- built with `prisma migrate deploy` never received them while databases
-- built with `prisma db push` already have them. Every statement is therefore
-- written to be a no-op when the object already exists.

-- CreateEnum
DO $$
BEGIN
  CREATE TYPE "WaitlistStatus" AS ENUM ('ACTIVE', 'NOTIFIED', 'CLAIMED', 'EXPIRED', 'CANCELLED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

-- AlterEnum
ALTER TYPE "BookingStatus" ADD VALUE IF NOT EXISTS 'CHECKED_IN';
ALTER TYPE "BookingStatus" ADD VALUE IF NOT EXISTS 'COMPLETED';

-- AlterTable
ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "quietHoursStart" TEXT,
  ADD COLUMN IF NOT EXISTS "quietHoursEnd" TEXT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "VenueLiveFeedback" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "userId" TEXT,
    "vibe" TEXT NOT NULL,
    "noiseLevel" TEXT,
    "isVerifiedCheckIn" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VenueLiveFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "VenuePhoto" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "blurhash" VARCHAR(32),
    "caption" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VenuePhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "UniversityMerkleRoot" (
    "id" TEXT NOT NULL,
    "university" TEXT NOT NULL,
    "campus" TEXT,
    "epoch" INTEGER NOT NULL DEFAULT 2026,
    "merkleRoot" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UniversityMerkleRoot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "StudentPassNullifier" (
    "id" TEXT NOT NULL,
    "nullifierHash" TEXT NOT NULL,
    "epoch" INTEGER NOT NULL DEFAULT 2026,
    "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudentPassNullifier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "StudentClaimNullifier" (
    "id" TEXT NOT NULL,
    "nullifierHash" TEXT NOT NULL,
    "epoch" INTEGER NOT NULL DEFAULT 2026,
    "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudentClaimNullifier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "VenueSeatWaitlist" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "seatId" TEXT,
    "seatType" "SeatType",
    "date" TEXT NOT NULL,
    "time" TEXT NOT NULL,
    "duration" INTEGER NOT NULL DEFAULT 60,
    "timeZone" TEXT DEFAULT 'UTC',
    "requiresQuiet" BOOLEAN NOT NULL DEFAULT false,
    "requiresOutlets" BOOLEAN NOT NULL DEFAULT false,
    "status" "WaitlistStatus" NOT NULL DEFAULT 'ACTIVE',
    "notifiedAt" TIMESTAMP(3),
    "claimExpiresAt" TIMESTAMP(3),
    "claimedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VenueSeatWaitlist_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "VenueLiveFeedback_venueId_expiresAt_idx" ON "VenueLiveFeedback"("venueId", "expiresAt");
CREATE INDEX IF NOT EXISTS "VenueLiveFeedback_venueId_createdAt_idx" ON "VenueLiveFeedback"("venueId", "createdAt");
CREATE INDEX IF NOT EXISTS "VenueLiveFeedback_userId_idx" ON "VenueLiveFeedback"("userId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "VenuePhoto_venueId_idx" ON "VenuePhoto"("venueId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "UniversityMerkleRoot_merkleRoot_key" ON "UniversityMerkleRoot"("merkleRoot");
CREATE INDEX IF NOT EXISTS "UniversityMerkleRoot_merkleRoot_isActive_idx" ON "UniversityMerkleRoot"("merkleRoot", "isActive");
CREATE INDEX IF NOT EXISTS "UniversityMerkleRoot_university_epoch_idx" ON "UniversityMerkleRoot"("university", "epoch");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "StudentPassNullifier_nullifierHash_key" ON "StudentPassNullifier"("nullifierHash");
CREATE INDEX IF NOT EXISTS "StudentPassNullifier_nullifierHash_idx" ON "StudentPassNullifier"("nullifierHash");
CREATE INDEX IF NOT EXISTS "StudentPassNullifier_epoch_idx" ON "StudentPassNullifier"("epoch");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "StudentClaimNullifier_nullifierHash_key" ON "StudentClaimNullifier"("nullifierHash");
CREATE INDEX IF NOT EXISTS "StudentClaimNullifier_nullifierHash_idx" ON "StudentClaimNullifier"("nullifierHash");
CREATE INDEX IF NOT EXISTS "StudentClaimNullifier_epoch_idx" ON "StudentClaimNullifier"("epoch");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "VenueSeatWaitlist_venueId_date_status_idx" ON "VenueSeatWaitlist"("venueId", "date", "status");
CREATE INDEX IF NOT EXISTS "VenueSeatWaitlist_userId_status_idx" ON "VenueSeatWaitlist"("userId", "status");
CREATE INDEX IF NOT EXISTS "VenueSeatWaitlist_seatId_idx" ON "VenueSeatWaitlist"("seatId");
CREATE INDEX IF NOT EXISTS "VenueSeatWaitlist_status_claimExpiresAt_idx" ON "VenueSeatWaitlist"("status", "claimExpiresAt");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'VenueLiveFeedback_venueId_fkey') THEN
    ALTER TABLE "VenueLiveFeedback" ADD CONSTRAINT "VenueLiveFeedback_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'VenueLiveFeedback_userId_fkey') THEN
    ALTER TABLE "VenueLiveFeedback" ADD CONSTRAINT "VenueLiveFeedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'VenuePhoto_venueId_fkey') THEN
    ALTER TABLE "VenuePhoto" ADD CONSTRAINT "VenuePhoto_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'VenueSeatWaitlist_userId_fkey') THEN
    ALTER TABLE "VenueSeatWaitlist" ADD CONSTRAINT "VenueSeatWaitlist_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'VenueSeatWaitlist_venueId_fkey') THEN
    ALTER TABLE "VenueSeatWaitlist" ADD CONSTRAINT "VenueSeatWaitlist_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'VenueSeatWaitlist_seatId_fkey') THEN
    ALTER TABLE "VenueSeatWaitlist" ADD CONSTRAINT "VenueSeatWaitlist_seatId_fkey" FOREIGN KEY ("seatId") REFERENCES "VenueSeat"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;

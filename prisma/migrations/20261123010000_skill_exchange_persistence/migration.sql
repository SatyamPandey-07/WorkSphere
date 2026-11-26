-- CreateEnum
CREATE TYPE "SkillListingStatus" AS ENUM ('OPEN', 'MATCHED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SkillMatchStatus" AS ENUM ('CONFIRMED', 'CANCELLED');

-- CreateTable
CREATE TABLE "SkillListing" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "venueName" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userName" TEXT NOT NULL,
    "userTitle" TEXT NOT NULL,
    "offeringSkill" TEXT NOT NULL,
    "offeringCategory" TEXT NOT NULL,
    "seekingSkill" TEXT NOT NULL,
    "seekingCategory" TEXT NOT NULL,
    "durationMinutes" INTEGER NOT NULL DEFAULT 30,
    "meetupSpot" TEXT NOT NULL,
    "status" "SkillListingStatus" NOT NULL DEFAULT 'OPEN',
    "reputationScore" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SkillListing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SkillMatch" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "proposerId" TEXT NOT NULL,
    "proposerName" TEXT NOT NULL,
    "meetupSpot" TEXT NOT NULL,
    "meetupTime" TEXT NOT NULL,
    "status" "SkillMatchStatus" NOT NULL DEFAULT 'CONFIRMED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SkillMatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SkillListing_venueId_idx" ON "SkillListing"("venueId");

-- CreateIndex
CREATE INDEX "SkillListing_userId_idx" ON "SkillListing"("userId");

-- CreateIndex
CREATE INDEX "SkillListing_status_idx" ON "SkillListing"("status");

-- CreateIndex
CREATE INDEX "SkillListing_offeringCategory_idx" ON "SkillListing"("offeringCategory");

-- CreateIndex
CREATE INDEX "SkillListing_seekingCategory_idx" ON "SkillListing"("seekingCategory");

-- CreateIndex
CREATE INDEX "SkillMatch_listingId_idx" ON "SkillMatch"("listingId");

-- CreateIndex
CREATE INDEX "SkillMatch_proposerId_idx" ON "SkillMatch"("proposerId");

-- CreateIndex
CREATE INDEX "SkillMatch_status_idx" ON "SkillMatch"("status");

-- AddForeignKey
ALTER TABLE "SkillMatch" ADD CONSTRAINT "SkillMatch_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "SkillListing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

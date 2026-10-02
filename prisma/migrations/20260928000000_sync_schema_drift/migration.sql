-- AlterTable
ALTER TABLE "Folder" ADD COLUMN     "color" TEXT DEFAULT '#3b82f6';

-- AlterTable
ALTER TABLE "Venue" ADD COLUMN     "equipmentLoadout" TEXT,
ADD COLUMN     "hasCCTV" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "hostMessage" TEXT,
ADD COLUMN     "isClaimed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isWellLit" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "largeDogsAllowed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "outdoorPetsOnly" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "ownerId" TEXT,
ADD COLUMN     "safetyScore" INTEGER,
ADD COLUMN     "servicePetsOnly" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "smallDogsOnly" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "tableSize" TEXT;

-- AlterTable
ALTER TABLE "VenueRating" ADD COLUMN     "downloadMbps" DOUBLE PRECISION,
ADD COLUMN     "tableSize" TEXT,
ADD COLUMN     "uploadMbps" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "VenueSeat" ADD COLUMN     "isQuietZone" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "zoneName" TEXT;

-- CreateIndex
CREATE INDEX "Booking_venueId_date_status_idx" ON "Booking"("venueId", "date", "status");

-- CreateIndex
CREATE INDEX "Favorite_venueId_idx" ON "Favorite"("venueId");


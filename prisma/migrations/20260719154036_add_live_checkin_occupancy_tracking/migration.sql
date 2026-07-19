-- CreateEnum
CREATE TYPE "GuestStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'CANCELLED');

-- DropForeignKey
ALTER TABLE "Booking" DROP CONSTRAINT "Booking_userId_fkey";

-- DropForeignKey
ALTER TABLE "Conversation" DROP CONSTRAINT "Conversation_userId_fkey";

-- DropForeignKey
ALTER TABLE "Favorite" DROP CONSTRAINT "Favorite_userId_fkey";

-- DropForeignKey
ALTER TABLE "Message" DROP CONSTRAINT "Message_conversationId_fkey";

-- DropForeignKey
ALTER TABLE "UserMemory" DROP CONSTRAINT "UserMemory_userId_fkey";

-- DropForeignKey
ALTER TABLE "VenueRating" DROP CONSTRAINT "VenueRating_userId_fkey";

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "projectBillingCode" TEXT;

-- AlterTable
ALTER TABLE "Folder" ADD COLUMN     "isPublic" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "upvotes" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "notificationEnd" TEXT,
ADD COLUMN     "notificationStart" TEXT,
ADD COLUMN     "phoneNumber" TEXT,
ADD COLUMN     "smsAlertsEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "telegramWebhookUrl" TEXT,
ADD COLUMN     "timezone" TEXT DEFAULT 'UTC',
ADD COLUMN     "workStyleProfile" TEXT;

-- AlterTable
ALTER TABLE "Venue" ADD COLUMN     "catsAllowed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "currentOccupancy" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "dogFriendly" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lighting" TEXT,
ADD COLUMN     "maxCapacity" INTEGER NOT NULL DEFAULT 50,
ADD COLUMN     "musicStyle" TEXT,
ADD COLUMN     "oatAlmondMilk" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "outletLocations" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "pourOverAvailable" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "powerTypes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "singleOriginBeans" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "specialtyEspresso" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "VenueRating" ADD COLUMN     "catsAllowed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "dogFriendly" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lighting" TEXT,
ADD COLUMN     "musicStyle" TEXT,
ADD COLUMN     "oatAlmondMilk" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "outletLocations" TEXT[],
ADD COLUMN     "patioOnly" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "petsAllowedIndoors" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pourOverAvailable" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "powerTypes" TEXT[],
ADD COLUMN     "singleOriginBeans" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "specialtyEspresso" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "waterBowlsProvided" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "BookingGuest" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "phone" TEXT,
    "status" "GuestStatus" NOT NULL DEFAULT 'PENDING',
    "calendarUid" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BookingGuest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FolderUpvote" (
    "id" TEXT NOT NULL,
    "folderId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FolderUpvote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckIn" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CheckIn_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BookingGuest_bookingId_idx" ON "BookingGuest"("bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "BookingGuest_bookingId_email_key" ON "BookingGuest"("bookingId", "email");

-- CreateIndex
CREATE INDEX "FolderUpvote_folderId_idx" ON "FolderUpvote"("folderId");

-- CreateIndex
CREATE INDEX "FolderUpvote_userId_idx" ON "FolderUpvote"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "FolderUpvote_folderId_userId_key" ON "FolderUpvote"("folderId", "userId");

-- CreateIndex
CREATE INDEX "CheckIn_venueId_idx" ON "CheckIn"("venueId");

-- CreateIndex
CREATE INDEX "CheckIn_expiresAt_idx" ON "CheckIn"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "CheckIn_userId_venueId_key" ON "CheckIn"("userId", "venueId");

-- CreateIndex
CREATE INDEX "AdminAuditLog_createdAt_idx" ON "AdminAuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "Booking_createdAt_idx" ON "Booking"("createdAt");

-- CreateIndex
CREATE INDEX "VenueRating_createdAt_idx" ON "VenueRating"("createdAt");

-- CreateIndex
CREATE INDEX "WebhookDeliveryLog_createdAt_idx" ON "WebhookDeliveryLog"("createdAt");

-- CreateIndex
CREATE INDEX "WebhookDeliveryLog_endpointId_createdAt_idx" ON "WebhookDeliveryLog"("endpointId", "createdAt");

-- CreateIndex
CREATE INDEX "WifiTelemetry_timestamp_idx" ON "WifiTelemetry"("timestamp");

-- CreateIndex
CREATE INDEX "WifiTelemetry_venueId_timestamp_idx" ON "WifiTelemetry"("venueId", "timestamp");

-- AddForeignKey
ALTER TABLE "VenueRating" ADD CONSTRAINT "VenueRating_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Favorite" ADD CONSTRAINT "Favorite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingGuest" ADD CONSTRAINT "BookingGuest_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserMemory" ADD CONSTRAINT "UserMemory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FolderUpvote" ADD CONSTRAINT "FolderUpvote_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "Folder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FolderUpvote" ADD CONSTRAINT "FolderUpvote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckIn" ADD CONSTRAINT "CheckIn_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckIn" ADD CONSTRAINT "CheckIn_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('CONFIRMED', 'PENDING', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RsvpStatus" AS ENUM ('GOING', 'MAYBE', 'DECLINED');

-- CreateEnum
CREATE TYPE "SeatType" AS ENUM ('HOT_DESK', 'FIXED_DESK', 'MEETING_ROOM', 'PHONE_BOOTH');

-- CreateEnum
CREATE TYPE "FlagType" AS ENUM ('VENUE', 'REVIEW');

-- CreateEnum
CREATE TYPE "FlagStatus" AS ENUM ('PENDING', 'DISMISSED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "FolderRole" AS ENUM ('OWNER', 'EDITOR', 'MEMBER');

-- CreateEnum
CREATE TYPE "WebhookEventType" AS ENUM ('DOCUMENT_SIGNED', 'AI_WORKFLOW_COMPLETED', 'MAP_GEOFENCE_BREACHED', 'VENUE_CREATED', 'REVIEW_SUBMITTED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "imageUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "crdtState" BYTEA,
    "preferencesSummary" TEXT,
    "isAdmin" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Venue" (
    "id" TEXT NOT NULL,
    "placeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "category" TEXT NOT NULL,
    "address" TEXT,
    "rating" DOUBLE PRECISION,
    "wifiQuality" INTEGER,
    "hasOutlets" BOOLEAN NOT NULL DEFAULT false,
    "noiseLevel" TEXT,
    "hasErgonomic" BOOLEAN NOT NULL DEFAULT false,
    "hasPhoneBooths" BOOLEAN NOT NULL DEFAULT false,
    "hasNoMusic" BOOLEAN NOT NULL DEFAULT false,
    "hasQuietZone" BOOLEAN NOT NULL DEFAULT false,
    "petsAllowedIndoors" BOOLEAN NOT NULL DEFAULT false,
    "patioOnly" BOOLEAN NOT NULL DEFAULT false,
    "waterBowlsProvided" BOOLEAN NOT NULL DEFAULT false,
    "outletDensity" TEXT,
    "wifiSpeed" INTEGER,
    "crowdsourced" BOOLEAN NOT NULL DEFAULT false,
    "requiresReview" BOOLEAN NOT NULL DEFAULT false,
    "imageUrl" TEXT,
    "googlePlaceId" TEXT,
    "photoReference" TEXT,
    "menuPhotos" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "creatorId" TEXT,

    CONSTRAINT "Venue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VenueRating" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "wifiQuality" INTEGER NOT NULL,
    "hasOutlets" BOOLEAN NOT NULL,
    "noiseLevel" TEXT NOT NULL,
    "hasErgonomic" BOOLEAN NOT NULL DEFAULT false,
    "hasPhoneBooths" BOOLEAN NOT NULL DEFAULT false,
    "hasNoMusic" BOOLEAN NOT NULL DEFAULT false,
    "hasQuietZone" BOOLEAN NOT NULL DEFAULT false,
    "outletDensity" TEXT,
    "wifiSpeed" INTEGER,
    "comment" TEXT,
    "speedtestPhoto" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "avgDecibels" DOUBLE PRECISION,
    "peakDecibels" DOUBLE PRECISION,

    CONSTRAINT "VenueRating_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Favorite" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Favorite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT DEFAULT 'Work Space Search',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "agentName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Booking" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "time" TEXT NOT NULL,
    "customerEmail" TEXT NOT NULL,
    "customerPhone" TEXT,
    "status" "BookingStatus" NOT NULL DEFAULT 'CONFIRMED',
    "confirmationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "seatId" TEXT,
    "seatNumber" TEXT,
    "duration" INTEGER,
    "amenitiesNeeded" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "Booking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserMemory" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "embedding" vector(1024),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserMemory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SemanticCache" (
    "id" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "location" TEXT,
    "response" TEXT NOT NULL,
    "embedding" vector(1024),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SemanticCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AmenityValidation" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "amenity" TEXT NOT NULL,
    "upvotes" INTEGER NOT NULL DEFAULT 0,
    "downvotes" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AmenityValidation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AmenityVote" (
    "id" TEXT NOT NULL,
    "validationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "isUpvote" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AmenityVote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkBuddyStatus" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "note" TEXT,
    "until" TIMESTAMP(3) NOT NULL,
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkBuddyStatus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoworkingSession" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "hostId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "maxGuests" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoworkingSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionRsvp" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "RsvpStatus" NOT NULL DEFAULT 'GOING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SessionRsvp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VenueSeat" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "seatNumber" TEXT NOT NULL,
    "type" "SeatType" NOT NULL DEFAULT 'HOT_DESK',
    "x" INTEGER NOT NULL,
    "y" INTEGER NOT NULL,
    "width" INTEGER NOT NULL DEFAULT 72,
    "height" INTEGER NOT NULL DEFAULT 48,
    "amenities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VenueSeat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WifiTelemetry" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "download" DOUBLE PRECISION NOT NULL,
    "upload" DOUBLE PRECISION NOT NULL,
    "latency" DOUBLE PRECISION NOT NULL,
    "crowdLevel" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WifiTelemetry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FlaggedItem" (
    "id" TEXT NOT NULL,
    "type" "FlagType" NOT NULL,
    "itemId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "FlagStatus" NOT NULL DEFAULT 'PENDING',
    "reportedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FlaggedItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminAuditLog" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "details" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Folder" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "ownerId" TEXT NOT NULL,
    "inviteToken" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Folder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FolderVenue" (
    "id" TEXT NOT NULL,
    "folderId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "addedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FolderVenue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FolderMember" (
    "id" TEXT NOT NULL,
    "folderId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "FolderRole" NOT NULL DEFAULT 'MEMBER',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FolderMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEndpoint" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "eventTypes" "WebhookEventType"[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebhookEndpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookDeliveryLog" (
    "id" TEXT NOT NULL,
    "endpointId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "statusCode" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookDeliveryLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Venue_placeId_key" ON "Venue"("placeId");

-- CreateIndex
CREATE INDEX "Venue_latitude_longitude_idx" ON "Venue"("latitude", "longitude");

-- CreateIndex
CREATE INDEX "Venue_category_idx" ON "Venue"("category");

-- CreateIndex
CREATE INDEX "VenueRating_venueId_idx" ON "VenueRating"("venueId");

-- CreateIndex
CREATE UNIQUE INDEX "VenueRating_userId_venueId_key" ON "VenueRating"("userId", "venueId");

-- CreateIndex
CREATE INDEX "Favorite_userId_idx" ON "Favorite"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Favorite_userId_venueId_key" ON "Favorite"("userId", "venueId");

-- CreateIndex
CREATE INDEX "Conversation_userId_idx" ON "Conversation"("userId");

-- CreateIndex
CREATE INDEX "Message_conversationId_idx" ON "Message"("conversationId");

-- CreateIndex
CREATE UNIQUE INDEX "Booking_confirmationId_key" ON "Booking"("confirmationId");

-- CreateIndex
CREATE INDEX "Booking_userId_idx" ON "Booking"("userId");

-- CreateIndex
CREATE INDEX "Booking_venueId_idx" ON "Booking"("venueId");

-- CreateIndex
CREATE INDEX "Booking_seatId_idx" ON "Booking"("seatId");

-- CreateIndex
CREATE INDEX "UserMemory_userId_idx" ON "UserMemory"("userId");

-- CreateIndex
CREATE INDEX "SemanticCache_query_idx" ON "SemanticCache"("query");

-- CreateIndex
CREATE INDEX "AmenityValidation_venueId_idx" ON "AmenityValidation"("venueId");

-- CreateIndex
CREATE UNIQUE INDEX "AmenityValidation_venueId_amenity_key" ON "AmenityValidation"("venueId", "amenity");

-- CreateIndex
CREATE UNIQUE INDEX "AmenityVote_userId_validationId_key" ON "AmenityVote"("userId", "validationId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkBuddyStatus_userId_key" ON "WorkBuddyStatus"("userId");

-- CreateIndex
CREATE INDEX "WorkBuddyStatus_venueId_idx" ON "WorkBuddyStatus"("venueId");

-- CreateIndex
CREATE INDEX "WorkBuddyStatus_until_idx" ON "WorkBuddyStatus"("until");

-- CreateIndex
CREATE UNIQUE INDEX "CoworkingSession_slug_key" ON "CoworkingSession"("slug");

-- CreateIndex
CREATE INDEX "CoworkingSession_hostId_idx" ON "CoworkingSession"("hostId");

-- CreateIndex
CREATE INDEX "CoworkingSession_venueId_idx" ON "CoworkingSession"("venueId");

-- CreateIndex
CREATE INDEX "CoworkingSession_startsAt_idx" ON "CoworkingSession"("startsAt");

-- CreateIndex
CREATE INDEX "SessionRsvp_userId_idx" ON "SessionRsvp"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "SessionRsvp_sessionId_userId_key" ON "SessionRsvp"("sessionId", "userId");

-- CreateIndex
CREATE INDEX "VenueSeat_venueId_idx" ON "VenueSeat"("venueId");

-- CreateIndex
CREATE UNIQUE INDEX "VenueSeat_venueId_seatNumber_key" ON "VenueSeat"("venueId", "seatNumber");

-- CreateIndex
CREATE INDEX "WifiTelemetry_venueId_idx" ON "WifiTelemetry"("venueId");

-- CreateIndex
CREATE INDEX "FlaggedItem_status_idx" ON "FlaggedItem"("status");

-- CreateIndex
CREATE INDEX "FlaggedItem_itemId_idx" ON "FlaggedItem"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "Folder_inviteToken_key" ON "Folder"("inviteToken");

-- CreateIndex
CREATE INDEX "Folder_ownerId_idx" ON "Folder"("ownerId");

-- CreateIndex
CREATE INDEX "FolderVenue_folderId_idx" ON "FolderVenue"("folderId");

-- CreateIndex
CREATE UNIQUE INDEX "FolderVenue_folderId_venueId_key" ON "FolderVenue"("folderId", "venueId");

-- CreateIndex
CREATE INDEX "FolderMember_folderId_idx" ON "FolderMember"("folderId");

-- CreateIndex
CREATE INDEX "FolderMember_userId_idx" ON "FolderMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "FolderMember_folderId_userId_key" ON "FolderMember"("folderId", "userId");

-- CreateIndex
CREATE INDEX "WebhookEndpoint_userId_idx" ON "WebhookEndpoint"("userId");

-- CreateIndex
CREATE INDEX "WebhookDeliveryLog_endpointId_idx" ON "WebhookDeliveryLog"("endpointId");

-- AddForeignKey
ALTER TABLE "Venue" ADD CONSTRAINT "Venue_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VenueRating" ADD CONSTRAINT "VenueRating_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VenueRating" ADD CONSTRAINT "VenueRating_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Favorite" ADD CONSTRAINT "Favorite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Favorite" ADD CONSTRAINT "Favorite_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_seatId_fkey" FOREIGN KEY ("seatId") REFERENCES "VenueSeat"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserMemory" ADD CONSTRAINT "UserMemory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AmenityValidation" ADD CONSTRAINT "AmenityValidation_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AmenityVote" ADD CONSTRAINT "AmenityVote_validationId_fkey" FOREIGN KEY ("validationId") REFERENCES "AmenityValidation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkBuddyStatus" ADD CONSTRAINT "WorkBuddyStatus_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkBuddyStatus" ADD CONSTRAINT "WorkBuddyStatus_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoworkingSession" ADD CONSTRAINT "CoworkingSession_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoworkingSession" ADD CONSTRAINT "CoworkingSession_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionRsvp" ADD CONSTRAINT "SessionRsvp_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "CoworkingSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionRsvp" ADD CONSTRAINT "SessionRsvp_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VenueSeat" ADD CONSTRAINT "VenueSeat_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WifiTelemetry" ADD CONSTRAINT "WifiTelemetry_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlaggedItem" ADD CONSTRAINT "FlaggedItem_reportedById_fkey" FOREIGN KEY ("reportedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminAuditLog" ADD CONSTRAINT "AdminAuditLog_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Folder" ADD CONSTRAINT "Folder_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FolderVenue" ADD CONSTRAINT "FolderVenue_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "Folder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FolderVenue" ADD CONSTRAINT "FolderVenue_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FolderVenue" ADD CONSTRAINT "FolderVenue_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FolderMember" ADD CONSTRAINT "FolderMember_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "Folder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FolderMember" ADD CONSTRAINT "FolderMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookEndpoint" ADD CONSTRAINT "WebhookEndpoint_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookDeliveryLog" ADD CONSTRAINT "WebhookDeliveryLog_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "WebhookEndpoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

/*
  Warnings:

  - You are about to drop the `TelemetryReading` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- DropIndex
DROP INDEX "Venue_searchEmbedding_hnsw_idx";

-- DropIndex
DROP INDEX "Venue_searchVector_gin_idx";

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "totalDeepWorkMinutes" INTEGER NOT NULL DEFAULT 0;

-- DropTable
DROP TABLE "TelemetryReading";

-- CreateTable
CREATE TABLE "PrivacyJammerSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "durationMinutes" DOUBLE PRECISION NOT NULL,
    "averageDelayMs" DOUBLE PRECISION NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrivacyJammerSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErgonomicSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "durationMinutes" DOUBLE PRECISION NOT NULL,
    "averageStrainScore" DOUBLE PRECISION NOT NULL,
    "peakStrainJoint" TEXT NOT NULL DEFAULT 'unknown',
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ErgonomicSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LocalEvent" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "venueName" TEXT NOT NULL,
    "venueLat" DOUBLE PRECISION NOT NULL,
    "venueLng" DOUBLE PRECISION NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "attendeeCount" INTEGER NOT NULL DEFAULT 0,
    "sourceUrl" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LocalEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchmakingSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "matchesFound" INTEGER NOT NULL,
    "topRoiScore" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatchmakingSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JetLagProtocol" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "originTimezone" TEXT NOT NULL,
    "destinationTimezone" TEXT NOT NULL,
    "protocolData" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JetLagProtocol_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IoTOrchestrationLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "zoneId" TEXT NOT NULL,
    "deskId" TEXT NOT NULL,
    "sessionState" TEXT NOT NULL,
    "commandsIssued" INTEGER NOT NULL,
    "executedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IoTOrchestrationLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeshSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "meshToken" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "contributionMb" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MeshSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmergencyMessage" (
    "id" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "encryptedPayload" TEXT NOT NULL,
    "gpsLat" DOUBLE PRECISION,
    "gpsLng" DOUBLE PRECISION,
    "hopCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmergencyMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VenueTelemetry" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "sensorId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VenueTelemetry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VenueStateSnapshot" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "stateJson" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VenueStateSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeepWorkCredential" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "focusThreshold" DOUBLE PRECISION NOT NULL,
    "commitmentHash" TEXT NOT NULL,
    "proofData" TEXT NOT NULL,
    "mintedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeepWorkCredential_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PrivacyJammerSession_userId_completedAt_idx" ON "PrivacyJammerSession"("userId", "completedAt");

-- CreateIndex
CREATE INDEX "ErgonomicSession_userId_completedAt_idx" ON "ErgonomicSession"("userId", "completedAt");

-- CreateIndex
CREATE INDEX "LocalEvent_startTime_idx" ON "LocalEvent"("startTime");

-- CreateIndex
CREATE INDEX "MatchmakingSession_userId_idx" ON "MatchmakingSession"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "JetLagProtocol_userId_originTimezone_destinationTimezone_key" ON "JetLagProtocol"("userId", "originTimezone", "destinationTimezone");

-- CreateIndex
CREATE INDEX "IoTOrchestrationLog_userId_idx" ON "IoTOrchestrationLog"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "MeshSession_meshToken_key" ON "MeshSession"("meshToken");

-- CreateIndex
CREATE INDEX "MeshSession_userId_createdAt_idx" ON "MeshSession"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "EmergencyMessage_senderId_idx" ON "EmergencyMessage"("senderId");

-- CreateIndex
CREATE INDEX "VenueTelemetry_venueId_roomId_recordedAt_idx" ON "VenueTelemetry"("venueId", "roomId", "recordedAt");

-- CreateIndex
CREATE UNIQUE INDEX "VenueTelemetry_sensorId_recordedAt_key" ON "VenueTelemetry"("sensorId", "recordedAt");

-- CreateIndex
CREATE INDEX "VenueStateSnapshot_venueId_createdAt_idx" ON "VenueStateSnapshot"("venueId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DeepWorkCredential_sessionId_key" ON "DeepWorkCredential"("sessionId");

-- CreateIndex
CREATE INDEX "DeepWorkCredential_userId_mintedAt_idx" ON "DeepWorkCredential"("userId", "mintedAt");

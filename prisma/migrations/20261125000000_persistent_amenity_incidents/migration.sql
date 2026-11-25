-- CreateEnum
CREATE TYPE "AmenityIncidentCategory" AS ENUM ('wifi', 'outlets', 'coffee', 'phone_booth', 'air_conditioning', 'restrooms', 'monitors', 'quiet_zone');

-- CreateEnum
CREATE TYPE "AmenityOperationalStatus" AS ENUM ('OPERATIONAL', 'DEGRADED', 'OUTAGE', 'MAINTENANCE');

-- CreateEnum
CREATE TYPE "AmenityIncidentSeverity" AS ENUM ('low', 'medium', 'critical');

-- CreateTable
CREATE TABLE "AmenityIncident" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "amenity" "AmenityIncidentCategory" NOT NULL,
    "amenityLabel" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "AmenityOperationalStatus" NOT NULL DEFAULT 'DEGRADED',
    "severity" "AmenityIncidentSeverity" NOT NULL DEFAULT 'medium',
    "reporterId" TEXT NOT NULL,
    "reporterName" TEXT NOT NULL,
    "reporterAvatarUrl" TEXT,
    "areaLocation" TEXT,
    "confirmationsCount" INTEGER NOT NULL DEFAULT 1,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AmenityIncident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AmenityIncidentConfirmation" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "confirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AmenityIncidentConfirmation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AmenityIncident_venueId_resolved_expiresAt_idx" ON "AmenityIncident"("venueId", "resolved", "expiresAt");

-- CreateIndex
CREATE INDEX "AmenityIncident_venueId_createdAt_idx" ON "AmenityIncident"("venueId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "AmenityIncident_expiresAt_idx" ON "AmenityIncident"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "AmenityIncidentConfirmation_incidentId_userId_key" ON "AmenityIncidentConfirmation"("incidentId", "userId");

-- CreateIndex
CREATE INDEX "AmenityIncidentConfirmation_incidentId_idx" ON "AmenityIncidentConfirmation"("incidentId");

-- CreateIndex
CREATE INDEX "AmenityIncidentConfirmation_userId_idx" ON "AmenityIncidentConfirmation"("userId");

-- AddForeignKey
ALTER TABLE "AmenityIncidentConfirmation" ADD CONSTRAINT "AmenityIncidentConfirmation_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "AmenityIncident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

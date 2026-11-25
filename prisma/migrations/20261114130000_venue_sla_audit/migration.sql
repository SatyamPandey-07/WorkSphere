-- Durable webhook delivery outbox and persistent venue SLA audit history.
ALTER TABLE "Venue"
  ADD COLUMN "slaPenaltyPoints" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "slaComplianceScore" DOUBLE PRECISION,
  ADD COLUMN "slaLastAuditedAt" TIMESTAMP(3);

CREATE TABLE "VenueSlaAudit" (
  "id" TEXT NOT NULL,
  "venueId" TEXT NOT NULL,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "periodEnd" TIMESTAMP(3) NOT NULL,
  "thresholdVersion" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "sampleCount" INTEGER NOT NULL DEFAULT 0,
  "avgWifiSpeedMbps" DOUBLE PRECISION,
  "wifiUptimePercent" DOUBLE PRECISION,
  "avgNoiseLevelDb" DOUBLE PRECISION,
  "avgSeatAvailabilityPercent" DOUBLE PRECISION,
  "complianceScore" DOUBLE PRECISION,
  "isCompliant" BOOLEAN,
  "penaltyPoints" INTEGER,
  "violations" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VenueSlaAudit_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "VenueSlaAudit_venueId_fkey"
    FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "VenueSlaAudit_venueId_periodStart_periodEnd_thresholdVersion_key"
  ON "VenueSlaAudit"("venueId", "periodStart", "periodEnd", "thresholdVersion");
CREATE INDEX "VenueSlaAudit_venueId_periodEnd_idx"
  ON "VenueSlaAudit"("venueId", "periodEnd");
CREATE INDEX "VenueSlaAudit_periodStart_periodEnd_idx"
  ON "VenueSlaAudit"("periodStart", "periodEnd");

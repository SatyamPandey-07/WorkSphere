-- Persistent micro-billing session for pay-as-you-go desks (#8436).
CREATE TYPE "MicroBillingSessionStatus" AS ENUM (
  'ACTIVE',
  'PAUSED',
  'SETTLING',
  'SETTLED',
  'FAILED'
);

CREATE TABLE "MicroBillingSessionRecord" (
  "id"                TEXT NOT NULL,
  "sessionId"         TEXT NOT NULL,
  "deskId"            TEXT NOT NULL,
  "deskName"          TEXT NOT NULL,
  "venueName"         TEXT NOT NULL,
  "userId"            TEXT,
  "paymentRail"       TEXT NOT NULL,
  "status"            "MicroBillingSessionStatus" NOT NULL DEFAULT 'ACTIVE',
  "startTime"         TIMESTAMP(3) NOT NULL,
  "lastHeartbeatTime" TIMESTAMP(3) NOT NULL,
  "elapsedSeconds"    INTEGER NOT NULL DEFAULT 0,
  "hourlyRateUsd"     DECIMAL(10, 4) NOT NULL,
  "totalAccruedUsd"   DECIMAL(10, 4) NOT NULL DEFAULT 0,
  "totalAccruedSats"  BIGINT NOT NULL DEFAULT 0,
  "totalAccruedUsdc"  DECIMAL(10, 4) NOT NULL DEFAULT 0,
  "depositHoldUsd"    DECIMAL(10, 4) NOT NULL DEFAULT 10.0,
  "paymentProofHash"  TEXT,
  "settledAt"         TIMESTAMP(3),
  "idempotencyKey"    TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL,

  CONSTRAINT "MicroBillingSessionRecord_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MicroBillingSessionRecord_sessionId_key"
  ON "MicroBillingSessionRecord"("sessionId");

CREATE UNIQUE INDEX "MicroBillingSessionRecord_idempotencyKey_key"
  ON "MicroBillingSessionRecord"("idempotencyKey");

CREATE INDEX "MicroBillingSessionRecord_userId_idx"
  ON "MicroBillingSessionRecord"("userId");

CREATE INDEX "MicroBillingSessionRecord_deskId_idx"
  ON "MicroBillingSessionRecord"("deskId");

CREATE INDEX "MicroBillingSessionRecord_status_idx"
  ON "MicroBillingSessionRecord"("status");

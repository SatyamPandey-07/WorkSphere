ALTER TYPE "BookingStatus" ADD VALUE IF NOT EXISTS 'CANCELLED_BY_OPERATOR';

CREATE TABLE "VenueCancellationWebhookEvent" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VenueCancellationWebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VenueCancellationWebhookEvent_idempotencyKey_key"
    ON "VenueCancellationWebhookEvent"("idempotencyKey");

CREATE INDEX "VenueCancellationWebhookEvent_bookingId_idx"
    ON "VenueCancellationWebhookEvent"("bookingId");

CREATE INDEX "VenueCancellationWebhookEvent_expiresAt_idx"
    ON "VenueCancellationWebhookEvent"("expiresAt");

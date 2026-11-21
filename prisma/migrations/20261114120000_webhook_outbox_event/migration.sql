-- Durable webhook delivery outbox.

CREATE TABLE "WebhookOutboxEvent" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "eventType" "WebhookEventType" NOT NULL,
  "data" JSONB NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "completedEndpointIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "permanentFailureEndpointIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "lastError" TEXT,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lockedUntil" TIMESTAMP(3),
  "deadLetteredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WebhookOutboxEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "WebhookOutboxEvent_state_nextAttemptAt_idx"
  ON "WebhookOutboxEvent"("state", "nextAttemptAt");
CREATE INDEX "WebhookOutboxEvent_state_lockedUntil_idx"
  ON "WebhookOutboxEvent"("state", "lockedUntil");

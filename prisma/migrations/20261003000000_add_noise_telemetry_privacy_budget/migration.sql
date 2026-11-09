CREATE TABLE "NoiseTelemetryRelease" (
    "venueId" TEXT NOT NULL,
    "epochKey" TEXT NOT NULL,
    "avgDecibels" DOUBLE PRECISION NOT NULL,
    "rdpCosts" JSONB NOT NULL,
    "submissions" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NoiseTelemetryRelease_pkey" PRIMARY KEY ("venueId", "epochKey")
);

CREATE INDEX "NoiseTelemetryRelease_epochKey_idx" ON "NoiseTelemetryRelease"("epochKey");

ALTER TABLE "NoiseTelemetryRelease"
ADD CONSTRAINT "NoiseTelemetryRelease_venueId_fkey"
FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- CreateTable
CREATE TABLE "PoapClaim" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "wifiSsid" TEXT NOT NULL,
    "sensorHash" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PoapClaim_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PoapClaim_nonce_key" ON "PoapClaim"("nonce");

-- CreateIndex
CREATE INDEX "PoapClaim_userId_venueId_idx" ON "PoapClaim"("userId", "venueId");

-- CreateIndex
CREATE INDEX "PoapClaim_createdAt_idx" ON "PoapClaim"("createdAt");

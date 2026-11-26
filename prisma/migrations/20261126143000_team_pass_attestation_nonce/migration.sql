CREATE TABLE "TeamPassAttestationNonce" (
    "id" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "attestationId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "consumedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamPassAttestationNonce_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TeamPassAttestationNonce_nonce_key"
ON "TeamPassAttestationNonce"("nonce");

CREATE INDEX "TeamPassAttestationNonce_venueId_consumedAt_idx"
ON "TeamPassAttestationNonce"("venueId", "consumedAt");

CREATE INDEX "TeamPassAttestationNonce_expiresAt_idx"
ON "TeamPassAttestationNonce"("expiresAt");

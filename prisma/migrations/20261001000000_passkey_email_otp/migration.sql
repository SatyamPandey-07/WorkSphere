-- CreateTable
CREATE TABLE "PasskeyEmailOtp" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasskeyEmailOtp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PasskeyEmailOtp_userId_action_credentialId_idx" ON "PasskeyEmailOtp"("userId", "action", "credentialId");

-- CreateIndex
CREATE INDEX "PasskeyEmailOtp_expiresAt_idx" ON "PasskeyEmailOtp"("expiresAt");

-- AddForeignKey
ALTER TABLE "PasskeyEmailOtp" ADD CONSTRAINT "PasskeyEmailOtp_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

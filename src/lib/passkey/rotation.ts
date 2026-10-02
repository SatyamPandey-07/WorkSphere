import { prisma } from "@/lib/prisma";
import { isKeyExpired } from "./attestation";
import { consumePasskeyOtp } from "./emailOtp";
import type { VerifiedRegistration } from "./registration";

export const KEY_ROTATION_INTERVAL_DAYS = 90;

export interface RotationStatus {
  credentialId: string;
  name: string;
  expiresAt: Date;
  isExpired: boolean;
  daysUntilExpiry: number;
  needsRotation: boolean;
  lastUsedAt: Date;
  createdAt: Date;
}

export async function getPasskeyRotationStatus(
  userId: string,
): Promise<RotationStatus[]> {
  const credentials = await prisma.passkeyCredential.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });

  return credentials.map((cred) => {
    const expiresAt = new Date(cred.createdAt.getTime() + KEY_ROTATION_INTERVAL_DAYS * 24 * 60 * 60 * 1000);
    const now = new Date();
    const diffMs = expiresAt.getTime() - now.getTime();
    const daysUntilExpiry = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

    return {
      credentialId: cred.id,
      name: cred.name,
      expiresAt,
      isExpired: isKeyExpired(expiresAt),
      daysUntilExpiry,
      needsRotation: daysUntilExpiry <= 14,
      lastUsedAt: cred.lastUsedAt,
      createdAt: cred.createdAt,
    };
  });
}

export class PasskeyRotationConflictError extends Error {}

/**
 * Replace `oldCredentialId` with a freshly registered credential (#1991).
 *
 * Consuming the OTP, inserting the successor and revoking the old passkey
 * happen in one transaction: the user is never left with zero passkeys if a
 * step fails, and a replayed OTP cannot trigger a second rotation.
 */
export async function rotatePasskey(params: {
  userId: string;
  oldCredentialId: string;
  otpId: string;
  registration: VerifiedRegistration;
  name: string;
}): Promise<{
  id: string;
  credentialId: string;
  name: string;
  deviceType: string;
  backedUp: boolean;
  createdAt: Date;
  expiresAt: Date;
}> {
  const { userId, oldCredentialId, otpId, registration, name } = params;

  return prisma.$transaction(async (tx) => {
    if (!(await consumePasskeyOtp(otpId, tx))) {
      throw new PasskeyRotationConflictError(
        "This verification code was already used. Request a new code.",
      );
    }

    const revoked = await tx.passkeyCredential.deleteMany({
      where: { id: oldCredentialId, userId },
    });
    if (revoked.count !== 1) {
      throw new PasskeyRotationConflictError(
        "The passkey being rotated no longer exists.",
      );
    }

    const created = await tx.passkeyCredential.create({
      data: { userId, ...registration.credential, name },
      select: {
        id: true,
        credentialId: true,
        name: true,
        deviceType: true,
        backedUp: true,
        createdAt: true,
        expiresAt: true,
      },
    });

    await tx.passkeyChallenge.deleteMany({
      where: { id: registration.challengeId },
    });

    return created;
  });
}

export async function cleanupExpiredPasskeys(
  userId: string,
): Promise<{ deletedCount: number }> {
  const now = new Date();
  const ninetyDaysAgo = new Date(now.getTime() - KEY_ROTATION_INTERVAL_DAYS * 24 * 60 * 60 * 1000);
  const result = await prisma.passkeyCredential.deleteMany({
    where: {
      userId,
      createdAt: { lt: ninetyDaysAgo },
    },
  });

  return { deletedCount: result.count };
}

export async function markPasskeyUsed(credentialId: string): Promise<void> {
  await prisma.passkeyCredential.update({
    where: { id: credentialId },
    data: { lastUsedAt: new Date() },
  });
}

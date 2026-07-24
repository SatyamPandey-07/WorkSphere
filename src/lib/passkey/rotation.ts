import { prisma } from "@/lib/prisma";
import { getKeyExpiryDate, isKeyExpired } from "./attestation";

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

export async function rotatePasskey(
  userId: string,
  credentialId: string,
): Promise<{ success: boolean; newExpiresAt?: Date; error?: string }> {
  const credential = await prisma.passkeyCredential.findFirst({
    where: { id: credentialId, userId },
  });

  if (!credential) {
    return { success: false, error: "Credential not found" };
  }

  const newExpiresAt = getKeyExpiryDate();
  await prisma.passkeyCredential.update({
    where: { id: credentialId },
    data: { lastUsedAt: new Date() },
  });

  return { success: true, newExpiresAt };
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

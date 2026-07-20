export const COLLECTION_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function normalizeCollectionInviteEmail(email: string) {
  return email.trim().toLowerCase();
}

export function createCollectionInviteExpiry(now = Date.now()) {
  return new Date(now + COLLECTION_INVITE_TTL_MS);
}

export function isCollectionInviteExpired(
  expiresAt: Date | string | null | undefined,
  now = new Date(),
) {
  if (!expiresAt) return true;
  const ms =
    expiresAt instanceof Date
      ? expiresAt.getTime()
      : new Date(expiresAt).getTime();
  if (Number.isNaN(ms)) return true;
  return ms <= now.getTime();
}

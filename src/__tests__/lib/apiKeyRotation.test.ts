/**
 * Tests for API key rotation and revocation.
 */

interface ApiKey {
  id: string;
  userId: string;
  keyHash: string;
  createdAt: number;
  expiresAt: number | null;
  revokedAt?: number;
  label: string;
}

function isKeyActive(key: ApiKey, nowMs: number): boolean {
  if (key.revokedAt !== undefined) return false;
  if (key.expiresAt !== null && nowMs >= key.expiresAt) return false;
  return true;
}

function revokeKey(key: ApiKey, nowMs: number): ApiKey {
  return { ...key, revokedAt: nowMs };
}

function activeKeysForUser(keys: ApiKey[], userId: string, nowMs: number): ApiKey[] {
  return keys.filter((k) => k.userId === userId && isKeyActive(k, nowMs));
}

function needsRotation(key: ApiKey, nowMs: number, warningMs = 7 * 86_400_000): boolean {
  if (key.expiresAt === null) return false;
  return key.expiresAt - nowMs <= warningMs;
}

const NOW = 1_700_000_000_000;
const KEY_A: ApiKey = { id: "k1", userId: "u1", keyHash: "h1", createdAt: NOW - 86400_000, expiresAt: NOW + 30 * 86400_000, label: "prod" };
const KEY_B: ApiKey = { id: "k2", userId: "u1", keyHash: "h2", createdAt: NOW - 100_000, expiresAt: NOW - 1000, label: "expired" };
const KEY_C: ApiKey = { id: "k3", userId: "u1", keyHash: "h3", createdAt: NOW - 50_000,  expiresAt: NOW + 2 * 86400_000, label: "expiring-soon" };

describe("API key rotation", () => {
  it("active key not revoked or expired", () => {
    expect(isKeyActive(KEY_A, NOW)).toBe(true);
  });

  it("expired key is inactive", () => {
    expect(isKeyActive(KEY_B, NOW)).toBe(false);
  });

  it("revoked key is inactive", () => {
    const revoked = revokeKey(KEY_A, NOW);
    expect(isKeyActive(revoked, NOW)).toBe(false);
  });

  it("revokeKey sets revokedAt", () => {
    const revoked = revokeKey(KEY_A, NOW);
    expect(revoked.revokedAt).toBe(NOW);
  });

  it("revokeKey is immutable", () => {
    revokeKey(KEY_A, NOW);
    expect(KEY_A.revokedAt).toBeUndefined();
  });

  it("activeKeysForUser filters expired and revoked", () => {
    const active = activeKeysForUser([KEY_A, KEY_B, KEY_C], "u1", NOW);
    expect(active.map((k) => k.id)).toContain("k1");
    expect(active.map((k) => k.id)).not.toContain("k2");
  });

  it("needsRotation: expiring in 2 days → true", () => {
    expect(needsRotation(KEY_C, NOW)).toBe(true);
  });

  it("needsRotation: expiring in 30 days → false", () => {
    expect(needsRotation(KEY_A, NOW)).toBe(false);
  });

  it("needsRotation: null expiresAt → false (never expires)", () => {
    const noExpiry: ApiKey = { ...KEY_A, expiresAt: null };
    expect(needsRotation(noExpiry, NOW)).toBe(false);
  });
});

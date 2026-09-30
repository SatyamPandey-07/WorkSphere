/**
 * Tests for venue smart key/access management.
 */

interface SmartKey {
  keyId: string;
  userId: string;
  venueId: string;
  zones: string[];
  validFrom: number;
  validUntil: number;
  revokedAt: number | null;
  accessCount: number;
  maxAccess: number | null;   // null = unlimited
}

function isKeyValid(key: SmartKey, nowMs: number): boolean {
  if (key.revokedAt !== null) return false;
  if (nowMs < key.validFrom || nowMs > key.validUntil) return false;
  if (key.maxAccess !== null && key.accessCount >= key.maxAccess) return false;
  return true;
}

function canAccessZone(key: SmartKey, zoneId: string, nowMs: number): boolean {
  return isKeyValid(key, nowMs) && key.zones.includes(zoneId);
}

function recordAccess(key: SmartKey): SmartKey {
  if (key.revokedAt !== null) throw new Error("Key revoked");
  return { ...key, accessCount: key.accessCount + 1 };
}

function revokeKey(key: SmartKey, nowMs: number): SmartKey {
  return { ...key, revokedAt: nowMs };
}

function keysForZone(keys: SmartKey[], zoneId: string, nowMs: number): SmartKey[] {
  return keys.filter((k) => canAccessZone(k, zoneId, nowMs));
}

function grantTemporaryAccess(
  baseKey: SmartKey,
  additionalZone: string,
  durationMs: number,
  nowMs: number
): SmartKey {
  return {
    ...baseKey,
    keyId: `${baseKey.keyId}-temp`,
    zones: [...new Set([...baseKey.zones, additionalZone])],
    validFrom: nowMs,
    validUntil: nowMs + durationMs,
    accessCount: 0,
  };
}

const NOW = 1_700_000_000_000;
const KEY: SmartKey = {
  keyId: "k1", userId: "u1", venueId: "v1",
  zones: ["lobby", "floor1", "gym"],
  validFrom: NOW - 86_400_000, validUntil: NOW + 86_400_000,
  revokedAt: null, accessCount: 5, maxAccess: null,
};

describe("Venue smart key access management", () => {
  it("isKeyValid: active key → true", () => {
    expect(isKeyValid(KEY, NOW)).toBe(true);
  });

  it("isKeyValid: before valid window → false", () => {
    expect(isKeyValid(KEY, KEY.validFrom - 1)).toBe(false);
  });

  it("isKeyValid: revoked → false", () => {
    const revoked = revokeKey(KEY, NOW - 1000);
    expect(isKeyValid(revoked, NOW)).toBe(false);
  });

  it("isKeyValid: max access reached → false", () => {
    const limited = { ...KEY, maxAccess: 5, accessCount: 5 };
    expect(isKeyValid(limited, NOW)).toBe(false);
  });

  it("canAccessZone: lobby → true", () => {
    expect(canAccessZone(KEY, "lobby", NOW)).toBe(true);
  });

  it("canAccessZone: restricted area → false", () => {
    expect(canAccessZone(KEY, "server_room", NOW)).toBe(false);
  });

  it("recordAccess: increments count", () => {
    const updated = recordAccess(KEY);
    expect(updated.accessCount).toBe(6);
  });

  it("grantTemporaryAccess: adds zone to temp key", () => {
    const tempKey = grantTemporaryAccess(KEY, "rooftop", 3600_000, NOW);
    expect(tempKey.zones).toContain("rooftop");
    expect(tempKey.zones).toContain("lobby"); // preserves original
  });
});

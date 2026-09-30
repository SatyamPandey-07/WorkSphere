/**
 * Tests for venue VIP access privilege management.
 */

interface VipAccess {
  memberId: string;
  venueId: string;
  tier: "silver" | "gold" | "platinum";
  grantedAt: number;
  expiresAt: number | null;
  privileges: string[];
  accessCode: string;
}

function isVipActive(access: VipAccess, nowMs: number): boolean {
  if (access.expiresAt !== null && nowMs >= access.expiresAt) return false;
  return true;
}

function hasPrivilege(access: VipAccess, privilege: string, nowMs: number): boolean {
  if (!isVipActive(access, nowMs)) return false;
  return access.privileges.includes(privilege);
}

function activeVipMembers(
  accesses: VipAccess[],
  venueId: string,
  nowMs: number
): VipAccess[] {
  return accesses.filter((a) => a.venueId === venueId && isVipActive(a, nowMs));
}

function upgradeVipTier(access: VipAccess, newTier: VipAccess["tier"], additionalPrivileges: string[]): VipAccess {
  const tiers: VipAccess["tier"][] = ["silver", "gold", "platinum"];
  if (tiers.indexOf(newTier) <= tiers.indexOf(access.tier)) {
    throw new Error("Can only upgrade to higher tier");
  }
  return {
    ...access,
    tier: newTier,
    privileges: [...new Set([...access.privileges, ...additionalPrivileges])],
  };
}

const NOW = 1_700_000_000_000;
const VIP: VipAccess = {
  memberId: "u1", venueId: "v1", tier: "gold",
  grantedAt: NOW - 86_400_000, expiresAt: NOW + 30 * 86_400_000,
  privileges: ["priority_booking", "early_access", "guest_pass"],
  accessCode: "VIP-GOLD-123",
};

describe("Venue VIP access", () => {
  it("isVipActive: within expiry → true", () => {
    expect(isVipActive(VIP, NOW)).toBe(true);
  });

  it("isVipActive: expired → false", () => {
    expect(isVipActive(VIP, NOW + 35 * 86_400_000)).toBe(false);
  });

  it("isVipActive: no expiry → always true", () => {
    expect(isVipActive({ ...VIP, expiresAt: null }, NOW + 999_999_999)).toBe(true);
  });

  it("hasPrivilege: priority_booking → true", () => {
    expect(hasPrivilege(VIP, "priority_booking", NOW)).toBe(true);
  });

  it("hasPrivilege: lounge_access → false", () => {
    expect(hasPrivilege(VIP, "lounge_access", NOW)).toBe(false);
  });

  it("hasPrivilege: expired VIP → false even for valid privilege", () => {
    expect(hasPrivilege(VIP, "priority_booking", NOW + 35 * 86_400_000)).toBe(false);
  });

  it("upgradeVipTier: gold → platinum", () => {
    const upgraded = upgradeVipTier(VIP, "platinum", ["lounge_access"]);
    expect(upgraded.tier).toBe("platinum");
    expect(upgraded.privileges).toContain("lounge_access");
    expect(upgraded.privileges).toContain("priority_booking"); // preserved
  });

  it("upgradeVipTier: downgrade throws", () => {
    expect(() => upgradeVipTier(VIP, "silver", [])).toThrow("Can only upgrade");
  });

  it("activeVipMembers: filters by venue and active status", () => {
    const accesses = [VIP, { ...VIP, memberId: "u2", expiresAt: NOW - 1 }];
    expect(activeVipMembers(accesses, "v1", NOW)).toHaveLength(1);
  });
});

/**
 * Tests for venue policy agreement tracking.
 */

interface PolicyAgreement {
  userId: string;
  venueId: string;
  policyVersion: string;
  agreedAt: number;
}

interface VenuePolicy {
  venueId: string;
  currentVersion: string;
  lastUpdatedAt: number;
}

function hasAgreedToCurrentPolicy(
  agreements: PolicyAgreement[],
  userId: string,
  policy: VenuePolicy
): boolean {
  return agreements.some(
    (a) =>
      a.userId === userId &&
      a.venueId === policy.venueId &&
      a.policyVersion === policy.currentVersion
  );
}

function requiresNewAgreement(
  agreements: PolicyAgreement[],
  userId: string,
  policy: VenuePolicy
): boolean {
  return !hasAgreedToCurrentPolicy(agreements, userId, policy);
}

function latestAgreement(
  agreements: PolicyAgreement[],
  userId: string,
  venueId: string
): PolicyAgreement | null {
  const userVenueAgreements = agreements.filter(
    (a) => a.userId === userId && a.venueId === venueId
  );
  if (userVenueAgreements.length === 0) return null;
  return userVenueAgreements.reduce((latest, a) =>
    a.agreedAt > latest.agreedAt ? a : latest
  );
}

const NOW = 1_700_000_000_000;
const POLICY: VenuePolicy = { venueId: "v1", currentVersion: "2.0", lastUpdatedAt: NOW - 86400_000 };
const AGREEMENTS: PolicyAgreement[] = [
  { userId: "u1", venueId: "v1", policyVersion: "1.0", agreedAt: NOW - 200_000 },
  { userId: "u1", venueId: "v1", policyVersion: "2.0", agreedAt: NOW - 100_000 },
  { userId: "u2", venueId: "v1", policyVersion: "1.0", agreedAt: NOW - 500_000 },
];

describe("Venue policy agreement", () => {
  it("u1 has agreed to current v2.0", () => {
    expect(hasAgreedToCurrentPolicy(AGREEMENTS, "u1", POLICY)).toBe(true);
  });

  it("u2 has not agreed to current v2.0", () => {
    expect(hasAgreedToCurrentPolicy(AGREEMENTS, "u2", POLICY)).toBe(false);
  });

  it("unknown user has not agreed", () => {
    expect(hasAgreedToCurrentPolicy(AGREEMENTS, "u99", POLICY)).toBe(false);
  });

  it("requiresNewAgreement: u2 must re-agree", () => {
    expect(requiresNewAgreement(AGREEMENTS, "u2", POLICY)).toBe(true);
  });

  it("requiresNewAgreement: u1 does not need to re-agree", () => {
    expect(requiresNewAgreement(AGREEMENTS, "u1", POLICY)).toBe(false);
  });

  it("latestAgreement: returns most recent for u1", () => {
    const latest = latestAgreement(AGREEMENTS, "u1", "v1");
    expect(latest!.policyVersion).toBe("2.0");
  });

  it("latestAgreement: null for user with no agreements", () => {
    expect(latestAgreement(AGREEMENTS, "u99", "v1")).toBeNull();
  });
});

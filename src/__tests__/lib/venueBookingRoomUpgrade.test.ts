/**
 * Tests for room upgrade eligibility and pricing.
 */

type RoomTier = "economy" | "standard" | "premium" | "suite";

interface RoomUpgradePath {
  from: RoomTier;
  to: RoomTier;
  upgradePriceCents: number;
  requiresMembership: boolean;
  availableUnits: number;
}

function canUpgrade(path: RoomUpgradePath, hasMembership: boolean): boolean {
  if (path.requiresMembership && !hasMembership) return false;
  return path.availableUnits > 0;
}

function cheapestUpgradePath(
  paths: RoomUpgradePath[],
  from: RoomTier,
  hasMembership: boolean
): RoomUpgradePath | null {
  const eligible = paths.filter(
    (p) => p.from === from && canUpgrade(p, hasMembership)
  );
  if (eligible.length === 0) return null;
  return eligible.reduce((min, p) => p.upgradePriceCents < min.upgradePriceCents ? p : min);
}

function estimateSavings(
  currentRateCents: number,
  upgradeRateCents: number,
  upgradePriceCents: number,
  hours: number
): number {
  const hoursAtUpgrade = hours * upgradeRateCents;
  const hoursAtCurrent = hours * currentRateCents;
  const additionalCost = hoursAtUpgrade - hoursAtCurrent + upgradePriceCents;
  // Negative means upgrade costs more; positive means you'd save (e.g., if bundle is cheaper)
  return -additionalCost; // usually negative (upgrade costs extra)
}

function upgradeWaitlistPosition(
  waitlist: { userId: string; tier: string; requestedAt: number }[],
  userId: string,
  tier: string
): number {
  const relevant = waitlist
    .filter((w) => w.tier === tier)
    .sort((a, b) => a.requestedAt - b.requestedAt);
  const idx = relevant.findIndex((w) => w.userId === userId);
  return idx === -1 ? -1 : idx + 1;
}

const PATHS: RoomUpgradePath[] = [
  { from: "economy",  to: "standard", upgradePriceCents: 500,  requiresMembership: false, availableUnits: 3 },
  { from: "economy",  to: "premium",  upgradePriceCents: 1500, requiresMembership: true,  availableUnits: 1 },
  { from: "standard", to: "suite",    upgradePriceCents: 2000, requiresMembership: true,  availableUnits: 0 },
];

describe("Venue booking room upgrade", () => {
  it("canUpgrade: non-membership path → true", () => {
    expect(canUpgrade(PATHS[0], false)).toBe(true);
  });

  it("canUpgrade: membership required, no membership → false", () => {
    expect(canUpgrade(PATHS[1], false)).toBe(false);
  });

  it("canUpgrade: zero units → false", () => {
    expect(canUpgrade(PATHS[2], true)).toBe(false);
  });

  it("cheapestUpgradePath: economy to standard (no membership needed)", () => {
    const cheapest = cheapestUpgradePath(PATHS, "economy", false);
    expect(cheapest!.to).toBe("standard");
  });

  it("cheapestUpgradePath: with membership gets cheaper option but economy→standard is cheapest", () => {
    const cheapest = cheapestUpgradePath(PATHS, "economy", true);
    expect(cheapest!.upgradePriceCents).toBe(500); // standard cheaper than premium
  });

  it("cheapestUpgradePath: no available units → null", () => {
    expect(cheapestUpgradePath(PATHS, "standard", true)).toBeNull(); // no available suites
  });

  it("upgradeWaitlistPosition: user in waitlist → 1-indexed position", () => {
    const waitlist = [
      { userId: "u1", tier: "premium", requestedAt: 1000 },
      { userId: "u2", tier: "premium", requestedAt: 2000 },
    ];
    expect(upgradeWaitlistPosition(waitlist, "u1", "premium")).toBe(1);
    expect(upgradeWaitlistPosition(waitlist, "u2", "premium")).toBe(2);
  });

  it("upgradeWaitlistPosition: not in list → -1", () => {
    expect(upgradeWaitlistPosition([], "u99", "premium")).toBe(-1);
  });
});

/**
 * Tests for venue carbon offset calculation and credits.
 */

interface CarbonProfile {
  venueId: string;
  annualKwhConsumed: number;
  renewablePercent: number;
  transportEmissionsKg: number;
  offsetCreditsKg: number;
}

const KG_CO2_PER_KWH = 0.233;

function gridEmissionsKg(profile: CarbonProfile): number {
  const nonRenewable = profile.annualKwhConsumed * (1 - profile.renewablePercent / 100);
  return Math.round(nonRenewable * KG_CO2_PER_KWH);
}

function totalEmissionsKg(profile: CarbonProfile): number {
  return gridEmissionsKg(profile) + profile.transportEmissionsKg;
}

function netEmissionsKg(profile: CarbonProfile): number {
  return Math.max(0, totalEmissionsKg(profile) - profile.offsetCreditsKg);
}

function isCarbonNeutral(profile: CarbonProfile): boolean {
  return netEmissionsKg(profile) === 0;
}

function carbonNeutralRating(profile: CarbonProfile): "none" | "partial" | "neutral" | "positive" {
  const net = netEmissionsKg(profile);
  const total = totalEmissionsKg(profile);
  if (total === 0) return "positive";
  if (net === 0) return profile.offsetCreditsKg > total ? "positive" : "neutral";
  const offsetPct = profile.offsetCreditsKg / total;
  if (offsetPct >= 0.5) return "partial";
  return "none";
}

const PROFILE: CarbonProfile = {
  venueId: "v1",
  annualKwhConsumed: 50000,
  renewablePercent: 30,
  transportEmissionsKg: 2000,
  offsetCreditsKg: 0,
};

describe("Venue carbon offset", () => {
  it("gridEmissionsKg: 70% non-renewable of 50000 kWh", () => {
    expect(gridEmissionsKg(PROFILE)).toBe(8155);
  });

  it("totalEmissionsKg includes transport", () => {
    expect(totalEmissionsKg(PROFILE)).toBe(8155 + 2000);
  });

  it("netEmissionsKg: no offset = full total", () => {
    expect(netEmissionsKg(PROFILE)).toBe(totalEmissionsKg(PROFILE));
  });

  it("netEmissionsKg: fully offset = 0", () => {
    const fullOffset = { ...PROFILE, offsetCreditsKg: totalEmissionsKg(PROFILE) };
    expect(netEmissionsKg(fullOffset)).toBe(0);
  });

  it("netEmissionsKg: over-offset clamps to 0", () => {
    expect(netEmissionsKg({ ...PROFILE, offsetCreditsKg: 999999 })).toBe(0);
  });

  it("isCarbonNeutral: false when no offset", () => {
    expect(isCarbonNeutral(PROFILE)).toBe(false);
  });

  it("isCarbonNeutral: true when fully offset", () => {
    expect(isCarbonNeutral({ ...PROFILE, offsetCreditsKg: totalEmissionsKg(PROFILE) })).toBe(true);
  });

  it("carbonNeutralRating: no offset → none", () => {
    expect(carbonNeutralRating(PROFILE)).toBe("none");
  });

  it("carbonNeutralRating: 60% offset → partial", () => {
    const partial = { ...PROFILE, offsetCreditsKg: Math.round(totalEmissionsKg(PROFILE) * 0.6) };
    expect(carbonNeutralRating(partial)).toBe("partial");
  });

  it("carbonNeutralRating: fully offset → neutral", () => {
    const neutral = { ...PROFILE, offsetCreditsKg: totalEmissionsKg(PROFILE) };
    expect(carbonNeutralRating(neutral)).toBe("neutral");
  });
});

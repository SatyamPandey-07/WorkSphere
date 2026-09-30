/**
 * Tests for venue power outlet density and distribution analysis.
 */

interface OutletDistribution {
  venueId: string;
  totalOutlets: number;
  usbPorts: number;
  availableCapacity: number;  // total amps
  seatingCapacity: number;
  hasPublicCharging: boolean;
}

function outletsPerSeat(dist: OutletDistribution): number {
  if (dist.seatingCapacity === 0) return 0;
  return Math.round((dist.totalOutlets / dist.seatingCapacity) * 10) / 10;
}

function powerDensityScore(dist: OutletDistribution): number {
  const outletScore = Math.min(outletsPerSeat(dist) * 20, 50);
  const usbScore = dist.usbPorts > 0 ? Math.min((dist.usbPorts / dist.seatingCapacity) * 15, 20) : 0;
  const chargingBonus = dist.hasPublicCharging ? 10 : 0;
  const ampScore = dist.availableCapacity > 0 ? Math.min((dist.availableCapacity / dist.seatingCapacity) * 5, 20) : 0;
  return Math.round(outletScore + usbScore + chargingBonus + ampScore);
}

function isPowerAdequate(dist: OutletDistribution): boolean {
  return outletsPerSeat(dist) >= 0.5 && dist.availableCapacity >= dist.seatingCapacity * 2;
}

function powerLabel(score: number): "insufficient" | "adequate" | "generous" | "excellent" {
  if (score < 25) return "insufficient";
  if (score < 50) return "adequate";
  if (score < 75) return "generous";
  return "excellent";
}

const GOOD: OutletDistribution = {
  venueId: "v1", totalOutlets: 30, usbPorts: 20,
  availableCapacity: 120, seatingCapacity: 20, hasPublicCharging: true,
};

const POOR: OutletDistribution = {
  venueId: "v2", totalOutlets: 4, usbPorts: 0,
  availableCapacity: 15, seatingCapacity: 20, hasPublicCharging: false,
};

describe("Venue power outlet density", () => {
  it("outletsPerSeat: 30/20 = 1.5", () => {
    expect(outletsPerSeat(GOOD)).toBe(1.5);
  });

  it("outletsPerSeat: 0 seating → 0", () => {
    expect(outletsPerSeat({ ...GOOD, seatingCapacity: 0 })).toBe(0);
  });

  it("powerDensityScore: good venue high score", () => {
    expect(powerDensityScore(GOOD)).toBeGreaterThan(60);
  });

  it("powerDensityScore: poor venue low score", () => {
    expect(powerDensityScore(POOR)).toBeLessThan(30);
  });

  it("isPowerAdequate: good venue → true", () => {
    expect(isPowerAdequate(GOOD)).toBe(true);
  });

  it("isPowerAdequate: poor venue → false", () => {
    expect(isPowerAdequate(POOR)).toBe(false);
  });

  it("powerLabel: excellent for high score", () => {
    expect(powerLabel(80)).toBe("excellent");
  });

  it("powerLabel: insufficient for low score", () => {
    expect(powerLabel(15)).toBe("insufficient");
  });
});

/**
 * Tests for coworking day pass bundle management.
 */

interface DayPassBundle {
  bundleId: string;
  userId: string;
  passes: number;
  usedPasses: number;
  priceCents: number;
  expiryDate: string; // YYYY-MM-DD
  venueId: string;
}

function remainingPasses(bundle: DayPassBundle): number {
  return bundle.passes - bundle.usedPasses;
}

function isBundleExpired(bundle: DayPassBundle, todayStr: string): boolean {
  return todayStr > bundle.expiryDate;
}

function pricePerPass(bundle: DayPassBundle): number {
  if (bundle.passes === 0) return 0;
  return Math.round(bundle.priceCents / bundle.passes);
}

function usePass(bundle: DayPassBundle, todayStr: string): DayPassBundle {
  if (isBundleExpired(bundle, todayStr)) throw new Error("Bundle expired");
  if (remainingPasses(bundle) <= 0) throw new Error("No passes remaining");
  return { ...bundle, usedPasses: bundle.usedPasses + 1 };
}

function bundleValueRemaining(bundle: DayPassBundle): number {
  return remainingPasses(bundle) * pricePerPass(bundle);
}

const BUNDLE: DayPassBundle = {
  bundleId: "b1", userId: "u1",
  passes: 10, usedPasses: 3,
  priceCents: 50_000, expiryDate: "2026-12-31", venueId: "v1",
};

describe("Coworking day pass bundle", () => {
  it("remainingPasses: 10-3 = 7", () => {
    expect(remainingPasses(BUNDLE)).toBe(7);
  });

  it("isBundleExpired: before expiry → false", () => {
    expect(isBundleExpired(BUNDLE, "2026-10-01")).toBe(false);
  });

  it("isBundleExpired: after expiry → true", () => {
    expect(isBundleExpired(BUNDLE, "2027-01-01")).toBe(true);
  });

  it("pricePerPass: 50000/10 = 5000", () => {
    expect(pricePerPass(BUNDLE)).toBe(5000);
  });

  it("usePass: decrements usedPasses", () => {
    const updated = usePass(BUNDLE, "2026-10-01");
    expect(updated.usedPasses).toBe(4);
  });

  it("usePass: throws on expired bundle", () => {
    expect(() => usePass(BUNDLE, "2027-01-01")).toThrow("expired");
  });

  it("usePass: throws when no passes left", () => {
    const exhausted = { ...BUNDLE, usedPasses: 10 };
    expect(() => usePass(exhausted, "2026-10-01")).toThrow("No passes");
  });

  it("bundleValueRemaining: 7 passes × 5000 = 35000", () => {
    expect(bundleValueRemaining(BUNDLE)).toBe(35_000);
  });

  it("usePass is immutable", () => {
    usePass(BUNDLE, "2026-10-01");
    expect(BUNDLE.usedPasses).toBe(3);
  });
});

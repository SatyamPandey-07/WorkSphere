/**
 * Tests for venue booking package deal management.
 */

interface PackageDeal {
  packageId: string;
  venueId: string;
  name: string;
  description: string;
  includedItems: {
    type: "hours" | "coffee" | "printing" | "parking" | "meeting_room";
    quantity: number;
    unit: string;
  }[];
  packagePriceCents: number;
  individualPriceCents: number;  // what you'd pay separately
  validForDays: number;
  maxUsesPerDay: number;
}

function packageSavings(pkg: PackageDeal): number {
  return pkg.individualPriceCents - pkg.packagePriceCents;
}

function packageSavingsPct(pkg: PackageDeal): number {
  if (pkg.individualPriceCents === 0) return 0;
  return Math.round((packageSavings(pkg) / pkg.individualPriceCents) * 100);
}

function hasItem(pkg: PackageDeal, itemType: string): boolean {
  return pkg.includedItems.some((i) => i.type === itemType);
}

function totalIncludedValue(pkg: PackageDeal, hourlyRateCents: number): number {
  let value = 0;
  for (const item of pkg.includedItems) {
    if (item.type === "hours") value += item.quantity * hourlyRateCents;
    else if (item.type === "coffee") value += item.quantity * 350;
    else if (item.type === "printing") value += item.quantity * 20;
    else if (item.type === "parking") value += item.quantity * 500;
    else if (item.type === "meeting_room") value += item.quantity * 1500;
  }
  return value;
}

function isGoodDeal(pkg: PackageDeal): boolean {
  return packageSavingsPct(pkg) >= 15;
}

const PKG: PackageDeal = {
  packageId: "p1", venueId: "v1", name: "Full Day Bundle",
  description: "Everything you need for a full day",
  includedItems: [
    { type: "hours",        quantity: 8,  unit: "hours" },
    { type: "coffee",       quantity: 3,  unit: "cups"  },
    { type: "printing",     quantity: 20, unit: "pages" },
  ],
  packagePriceCents: 6500, individualPriceCents: 8050,
  validForDays: 30, maxUsesPerDay: 1,
};

describe("Venue booking package deals", () => {
  it("packageSavings: 8050-6500 = 1550 cents", () => {
    expect(packageSavings(PKG)).toBe(1550);
  });

  it("packageSavingsPct: ~19%", () => {
    expect(packageSavingsPct(PKG)).toBeCloseTo(19, 0);
  });

  it("isGoodDeal: 19% savings → true", () => {
    expect(isGoodDeal(PKG)).toBe(true);
  });

  it("isGoodDeal: 5% savings → false", () => {
    const badDeal = { ...PKG, packagePriceCents: 7650 }; // ~5% off
    expect(isGoodDeal(badDeal)).toBe(false);
  });

  it("hasItem: has hours → true", () => {
    expect(hasItem(PKG, "hours")).toBe(true);
  });

  it("hasItem: no parking → false", () => {
    expect(hasItem(PKG, "parking")).toBe(false);
  });

  it("totalIncludedValue: 8h×600 + 3×350 + 20×20 = 5950", () => {
    expect(totalIncludedValue(PKG, 600)).toBe(5950); // but this is less than pkg price...
  });
});

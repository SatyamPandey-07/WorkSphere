/**
 * Tests for venue bundle/package pricing (desk + amenities).
 */

interface BundleItem {
  name: string;
  priceCents: number;
  included: boolean; // included in base price vs add-on
}

interface VenueBundle {
  bundleId: string;
  name: string;
  baseRateCents: number;  // per hour
  items: BundleItem[];
  minHours: number;
}

function bundleAddOnCost(bundle: VenueBundle): number {
  return bundle.items
    .filter((i) => !i.included)
    .reduce((sum, i) => sum + i.priceCents, 0);
}

function bundleTotalCost(bundle: VenueBundle, hours: number, selectedAddOns: string[]): number {
  const baseHours = Math.max(hours, bundle.minHours);
  const base = bundle.baseRateCents * baseHours;
  const addOns = bundle.items
    .filter((i) => !i.included && selectedAddOns.includes(i.name))
    .reduce((sum, i) => sum + i.priceCents, 0);
  return base + addOns;
}

function includedAmenities(bundle: VenueBundle): string[] {
  return bundle.items.filter((i) => i.included).map((i) => i.name);
}

function availableAddOns(bundle: VenueBundle): BundleItem[] {
  return bundle.items.filter((i) => !i.included);
}

const BUNDLE: VenueBundle = {
  bundleId: "b1",
  name: "Desk Focus Bundle",
  baseRateCents: 1000,
  minHours: 2,
  items: [
    { name: "WiFi",        priceCents: 0,   included: true  },
    { name: "Coffee",      priceCents: 300, included: false },
    { name: "Locker",      priceCents: 500, included: false },
    { name: "Printing",    priceCents: 100, included: false },
  ],
};

describe("Venue bundle package", () => {
  it("bundleAddOnCost: coffee+locker+printing = 900", () => {
    expect(bundleAddOnCost(BUNDLE)).toBe(900);
  });

  it("bundleTotalCost: 3h with coffee = 3000 + 300 = 3300", () => {
    expect(bundleTotalCost(BUNDLE, 3, ["Coffee"])).toBe(3300);
  });

  it("bundleTotalCost: enforces minHours", () => {
    // 1h request, min 2h: base = 2000
    expect(bundleTotalCost(BUNDLE, 1, [])).toBe(2000);
  });

  it("bundleTotalCost: no add-ons selected = base only", () => {
    expect(bundleTotalCost(BUNDLE, 3, [])).toBe(3000);
  });

  it("includedAmenities: only WiFi included", () => {
    expect(includedAmenities(BUNDLE)).toEqual(["WiFi"]);
  });

  it("availableAddOns: 3 add-ons available", () => {
    expect(availableAddOns(BUNDLE)).toHaveLength(3);
  });

  it("bundleTotalCost: all add-ons = 3000 + 900 = 3900", () => {
    expect(bundleTotalCost(BUNDLE, 3, ["Coffee", "Locker", "Printing"])).toBe(3900);
  });
});

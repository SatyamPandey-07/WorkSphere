/**
 * Tests for multi-venue booking package bundling and discounts.
 */

interface VenuePackageItem {
  venueId: string;
  date: string;
  hours: number;
  pricePerHour: number;
}

interface VenuePackage {
  id: string;
  name: string;
  organizerId: string;
  items: VenuePackageItem[];
  packageDiscountPercent: number;
  status: "draft" | "confirmed" | "cancelled";
}

function packageSubtotal(pkg: VenuePackage): number {
  return Math.round(pkg.items.reduce((s, i) => s + i.hours * i.pricePerHour, 0) * 100) / 100;
}

function packageDiscount(pkg: VenuePackage): number {
  return Math.round(packageSubtotal(pkg) * (pkg.packageDiscountPercent / 100) * 100) / 100;
}

function packageTotal(pkg: VenuePackage): number {
  return Math.round((packageSubtotal(pkg) - packageDiscount(pkg)) * 100) / 100;
}

function uniqueVenueCount(pkg: VenuePackage): number {
  return new Set(pkg.items.map((i) => i.venueId)).size;
}

function totalHours(pkg: VenuePackage): number {
  return pkg.items.reduce((s, i) => s + i.hours, 0);
}

function qualifiesForBulkDiscount(pkg: VenuePackage, minVenues = 2, minHours = 8): boolean {
  return uniqueVenueCount(pkg) >= minVenues && totalHours(pkg) >= minHours;
}

const PACKAGE: VenuePackage = {
  id: "p1", name: "Conference Week", organizerId: "org1", status: "confirmed",
  packageDiscountPercent: 10,
  items: [
    { venueId: "v1", date: "2026-11-01", hours: 8, pricePerHour: 200 },
    { venueId: "v2", date: "2026-11-02", hours: 6, pricePerHour: 150 },
    { venueId: "v1", date: "2026-11-03", hours: 4, pricePerHour: 200 },
  ],
};

describe("Multi-venue package bundling", () => {
  it("packageSubtotal: 8*200 + 6*150 + 4*200 = $3500", () => {
    expect(packageSubtotal(PACKAGE)).toBe(3500);
  });

  it("packageDiscount: 10% of $3500 = $350", () => {
    expect(packageDiscount(PACKAGE)).toBe(350);
  });

  it("packageTotal: $3500 - $350 = $3150", () => {
    expect(packageTotal(PACKAGE)).toBe(3150);
  });

  it("uniqueVenueCount: 2 unique venues", () => {
    expect(uniqueVenueCount(PACKAGE)).toBe(2);
  });

  it("totalHours: 18 hours total", () => {
    expect(totalHours(PACKAGE)).toBe(18);
  });

  it("qualifiesForBulkDiscount: 2 venues, 18 hours → true", () => {
    expect(qualifiesForBulkDiscount(PACKAGE)).toBe(true);
  });
});

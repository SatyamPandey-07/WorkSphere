/**
 * Tests for venue vendor and supplier management utilities.
 */

type VendorCategory = "catering" | "cleaning" | "security" | "av_tech" | "decoration" | "photography";

interface Vendor {
  id: string;
  name: string;
  category: VendorCategory;
  rating: number;       // 0-5
  completedJobs: number;
  cancellationRate: number; // 0-1
  avgResponseHours: number;
  isPreferred: boolean;
}

function vendorScore(vendor: Vendor): number {
  const ratingWeight = vendor.rating / 5 * 40;
  const reliabilityWeight = (1 - vendor.cancellationRate) * 30;
  const responseWeight = Math.max(0, (24 - vendor.avgResponseHours) / 24) * 15;
  const experienceWeight = Math.min(vendor.completedJobs / 100, 1) * 15;
  return Math.round(ratingWeight + reliabilityWeight + responseWeight + experienceWeight);
}

function topVendorsByCategory(
  vendors: Vendor[],
  category: VendorCategory,
  limit = 3
): Vendor[] {
  return vendors
    .filter((v) => v.category === category)
    .sort((a, b) => vendorScore(b) - vendorScore(a))
    .slice(0, limit);
}

function avgVendorRating(vendors: Vendor[], category?: VendorCategory): number {
  const filtered = category ? vendors.filter((v) => v.category === category) : vendors;
  if (filtered.length === 0) return 0;
  return Math.round(filtered.reduce((s, v) => s + v.rating, 0) / filtered.length * 100) / 100;
}

function unreliableVendors(vendors: Vendor[], threshold = 0.15): Vendor[] {
  return vendors.filter((v) => v.cancellationRate > threshold);
}

function preferredVendorCount(vendors: Vendor[]): number {
  return vendors.filter((v) => v.isPreferred).length;
}

const VENDORS: Vendor[] = [
  { id: "v1", name: "TopChef Co",   category: "catering",  rating: 4.8, completedJobs: 150, cancellationRate: 0.02, avgResponseHours: 2,  isPreferred: true },
  { id: "v2", name: "EasyClean",    category: "cleaning",  rating: 4.2, completedJobs: 80,  cancellationRate: 0.08, avgResponseHours: 6,  isPreferred: false },
  { id: "v3", name: "QuickCater",   category: "catering",  rating: 3.8, completedJobs: 40,  cancellationRate: 0.2,  avgResponseHours: 12, isPreferred: false },
  { id: "v4", name: "SecurePro",    category: "security",  rating: 4.5, completedJobs: 200, cancellationRate: 0.01, avgResponseHours: 1,  isPreferred: true },
];

describe("Vendor management", () => {
  it("vendorScore: TopChef scores higher than QuickCater", () => {
    expect(vendorScore(VENDORS[0])).toBeGreaterThan(vendorScore(VENDORS[2]));
  });

  it("topVendorsByCategory: catering returns in order", () => {
    const top = topVendorsByCategory(VENDORS, "catering");
    expect(top[0].id).toBe("v1");
  });

  it("avgVendorRating: catering avg between 3.8 and 4.8", () => {
    const avg = avgVendorRating(VENDORS, "catering");
    expect(avg).toBeGreaterThan(3.8);
    expect(avg).toBeLessThan(4.8);
  });

  it("unreliableVendors: QuickCater has 20% cancellation", () => {
    const bad = unreliableVendors(VENDORS);
    expect(bad.map((v) => v.id)).toContain("v3");
  });

  it("preferredVendorCount: 2 preferred vendors", () => {
    expect(preferredVendorCount(VENDORS)).toBe(2);
  });
});

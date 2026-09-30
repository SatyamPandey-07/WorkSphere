/**
 * Tests for venue visitor analytics and demographic insights.
 */

type VisitorSegment = "freelancer" | "startup" | "enterprise" | "student" | "remote_worker";

interface VisitorDemographic {
  venueId: string;
  segment: VisitorSegment;
  count: number;
  avgSessionHours: number;
  avgSpendCents: number;
  repeatVisitRate: number; // 0-1
}

function dominantSegment(
  demographics: VisitorDemographic[],
  venueId: string
): VisitorSegment | null {
  const venue = demographics.filter((d) => d.venueId === venueId);
  if (venue.length === 0) return null;
  return venue.reduce((max, d) => d.count > max.count ? d : max).segment;
}

function segmentRevenuePotential(demo: VisitorDemographic): number {
  return Math.round(demo.count * demo.avgSpendCents * demo.repeatVisitRate);
}

function highValueSegments(
  demographics: VisitorDemographic[],
  venueId: string,
  minPotential: number
): VisitorSegment[] {
  return demographics
    .filter((d) => d.venueId === venueId && segmentRevenuePotential(d) >= minPotential)
    .map((d) => d.segment);
}

function totalUniqueVisitors(demographics: VisitorDemographic[], venueId: string): number {
  return demographics.filter((d) => d.venueId === venueId).reduce((s, d) => s + d.count, 0);
}

function avgSessionHoursBySegment(
  demographics: VisitorDemographic[],
  venueId: string
): Record<string, number> {
  const result: Record<string, number> = {};
  demographics.filter((d) => d.venueId === venueId).forEach((d) => {
    result[d.segment] = d.avgSessionHours;
  });
  return result;
}

const DEMOGRAPHICS: VisitorDemographic[] = [
  { venueId: "v1", segment: "freelancer",   count: 150, avgSessionHours: 4, avgSpendCents: 800,  repeatVisitRate: 0.7 },
  { venueId: "v1", segment: "startup",      count: 80,  avgSessionHours: 6, avgSpendCents: 1500, repeatVisitRate: 0.8 },
  { venueId: "v1", segment: "student",      count: 200, avgSessionHours: 3, avgSpendCents: 300,  repeatVisitRate: 0.5 },
  { venueId: "v2", segment: "enterprise",   count: 50,  avgSessionHours: 8, avgSpendCents: 3000, repeatVisitRate: 0.9 },
];

describe("Venue visitor analytics", () => {
  it("dominantSegment: v1 most visitors = student (200)", () => {
    expect(dominantSegment(DEMOGRAPHICS, "v1")).toBe("student");
  });

  it("dominantSegment: unknown venue → null", () => {
    expect(dominantSegment(DEMOGRAPHICS, "v99")).toBeNull();
  });

  it("segmentRevenuePotential: startup has high potential", () => {
    expect(segmentRevenuePotential(DEMOGRAPHICS[1])).toBeGreaterThan(50_000);
  });

  it("highValueSegments: segments above 50000 potential", () => {
    const high = highValueSegments(DEMOGRAPHICS, "v1", 50_000);
    expect(high).toContain("freelancer");
    expect(high).toContain("startup");
  });

  it("totalUniqueVisitors: v1 = 150+80+200 = 430", () => {
    expect(totalUniqueVisitors(DEMOGRAPHICS, "v1")).toBe(430);
  });

  it("avgSessionHoursBySegment: v1 freelancer = 4h", () => {
    const sessions = avgSessionHoursBySegment(DEMOGRAPHICS, "v1");
    expect(sessions.freelancer).toBe(4);
  });
});

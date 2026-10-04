/**
 * Tests for venue booking customer segmentation and profiling.
 */

type CustomerSegment = "enterprise" | "sme" | "individual" | "event_planner" | "social" | "government";

interface CustomerProfile {
  userId: string;
  segment: CustomerSegment;
  annualBookingValue: number;
  avgBookingSize: number;
  bookingFrequency: number;   // bookings per year
  preferredVenueTypes: string[];
  leadTime: number;           // avg days advance booking
  npsScore: number;           // -100 to 100
}

function segmentValue(profiles: CustomerProfile[], segment: CustomerSegment): number {
  return Math.round(
    profiles
      .filter((p) => p.segment === segment)
      .reduce((s, p) => s + p.annualBookingValue, 0) * 100
  ) / 100;
}

function avgNpsBySegment(profiles: CustomerProfile[]): Record<CustomerSegment, number> {
  const data: Record<string, { sum: number; count: number }> = {};
  for (const p of profiles) {
    if (!data[p.segment]) data[p.segment] = { sum: 0, count: 0 };
    data[p.segment].sum += p.npsScore;
    data[p.segment].count++;
  }
  const result: Partial<Record<CustomerSegment, number>> = {};
  for (const [seg, val] of Object.entries(data)) {
    result[seg as CustomerSegment] = Math.round(val.sum / val.count);
  }
  return result as Record<CustomerSegment, number>;
}

function highValueCustomers(profiles: CustomerProfile[], threshold = 10_000): CustomerProfile[] {
  return profiles.filter((p) => p.annualBookingValue >= threshold);
}

function avgLeadTimeBySegment(profiles: CustomerProfile[], segment: CustomerSegment): number {
  const segProfiles = profiles.filter((p) => p.segment === segment);
  if (segProfiles.length === 0) return 0;
  return Math.round(segProfiles.reduce((s, p) => s + p.leadTime, 0) / segProfiles.length);
}

function mostCommonVenueType(profiles: CustomerProfile[]): string | null {
  const counts: Record<string, number> = {};
  for (const p of profiles) {
    for (const vt of p.preferredVenueTypes) counts[vt] = (counts[vt] ?? 0) + 1;
  }
  const entries = Object.entries(counts);
  if (entries.length === 0) return null;
  return entries.sort((a, b) => b[1] - a[1])[0][0];
}

const PROFILES: CustomerProfile[] = [
  { userId: "u1", segment: "enterprise",     annualBookingValue: 50_000, avgBookingSize: 5000, bookingFrequency: 10, preferredVenueTypes: ["conference", "ballroom"], leadTime: 45, npsScore: 72 },
  { userId: "u2", segment: "sme",            annualBookingValue: 8_000,  avgBookingSize: 1000, bookingFrequency: 8,  preferredVenueTypes: ["boardroom", "conference"], leadTime: 14, npsScore: 55 },
  { userId: "u3", segment: "event_planner",  annualBookingValue: 35_000, avgBookingSize: 3500, bookingFrequency: 10, preferredVenueTypes: ["ballroom", "outdoor"],    leadTime: 60, npsScore: 80 },
  { userId: "u4", segment: "individual",     annualBookingValue: 2_000,  avgBookingSize: 500,  bookingFrequency: 4,  preferredVenueTypes: ["studio"],                 leadTime: 7,  npsScore: 65 },
];

describe("Customer segmentation and profiling", () => {
  it("segmentValue: enterprise = $50k", () => {
    expect(segmentValue(PROFILES, "enterprise")).toBe(50_000);
  });

  it("highValueCustomers: threshold $10k → u1 and u3", () => {
    const hv = highValueCustomers(PROFILES);
    expect(hv.map((p) => p.userId)).toContain("u1");
    expect(hv.map((p) => p.userId)).toContain("u3");
    expect(hv.map((p) => p.userId)).not.toContain("u4");
  });

  it("avgLeadTimeBySegment: enterprise = 45 days", () => {
    expect(avgLeadTimeBySegment(PROFILES, "enterprise")).toBe(45);
  });

  it("mostCommonVenueType: conference or ballroom", () => {
    const common = mostCommonVenueType(PROFILES);
    expect(["conference", "ballroom"]).toContain(common);
  });

  it("avgNpsBySegment: returns segment NPS scores", () => {
    const nps = avgNpsBySegment(PROFILES);
    expect(nps.enterprise).toBe(72);
    expect(nps.individual).toBe(65);
  });
});

/**
 * Tests for venue key performance indicator (KPI) computation.
 */

interface VenueKPIs {
  venueId: string;
  period: string;
  totalBookings: number;
  uniqueCustomers: number;
  grossRevenueCents: number;
  refundedCents: number;
  avgBookingDurationMinutes: number;
  customerSatisfactionScore: number; // 0-10
  responseTimeHours: number;
}

function netRevenue(kpis: VenueKPIs): number {
  return kpis.grossRevenueCents - kpis.refundedCents;
}

function revenuePerCustomer(kpis: VenueKPIs): number {
  if (kpis.uniqueCustomers === 0) return 0;
  return Math.round(netRevenue(kpis) / kpis.uniqueCustomers);
}

function bookingsPerCustomer(kpis: VenueKPIs): number {
  if (kpis.uniqueCustomers === 0) return 0;
  return Math.round((kpis.totalBookings / kpis.uniqueCustomers) * 10) / 10;
}

function overallPerformanceScore(kpis: VenueKPIs): number {
  const satisfactionScore = kpis.customerSatisfactionScore * 10; // 0-100
  const responseScore = Math.max(0, 100 - kpis.responseTimeHours * 4); // lower is better
  const refundPct = kpis.grossRevenueCents > 0 ? (kpis.refundedCents / kpis.grossRevenueCents) * 100 : 0;
  const refundScore = Math.max(0, 100 - refundPct * 5);
  return Math.round((satisfactionScore + responseScore + refundScore) / 3);
}

function performanceGrade(score: number): "A" | "B" | "C" | "D" | "F" {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}

const KPIS: VenueKPIs = {
  venueId: "v1", period: "2026-10",
  totalBookings: 100, uniqueCustomers: 60,
  grossRevenueCents: 500_000, refundedCents: 25_000,
  avgBookingDurationMinutes: 120, customerSatisfactionScore: 8.5,
  responseTimeHours: 2,
};

describe("Venue KPI computation", () => {
  it("netRevenue: 500000 - 25000 = 475000", () => {
    expect(netRevenue(KPIS)).toBe(475_000);
  });

  it("revenuePerCustomer: 475000/60 ≈ 7917", () => {
    expect(revenuePerCustomer(KPIS)).toBeCloseTo(7917, -1);
  });

  it("bookingsPerCustomer: 100/60 ≈ 1.7", () => {
    expect(bookingsPerCustomer(KPIS)).toBeCloseTo(1.7, 1);
  });

  it("overallPerformanceScore: high satisfaction + fast response → good", () => {
    expect(overallPerformanceScore(KPIS)).toBeGreaterThan(70);
  });

  it("performanceGrade: good score → B or better", () => {
    expect(["A", "B"]).toContain(performanceGrade(overallPerformanceScore(KPIS)));
  });

  it("performanceGrade: score 95 → A", () => {
    expect(performanceGrade(95)).toBe("A");
  });

  it("performanceGrade: score 55 → F", () => {
    expect(performanceGrade(55)).toBe("F");
  });
});

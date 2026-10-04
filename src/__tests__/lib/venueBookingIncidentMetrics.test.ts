/**
 * Tests for venue operations incident metrics and KPI tracking.
 */

interface IncidentMetric {
  month: string;
  totalIncidents: number;
  resolvedIncidents: number;
  avgResolutionHours: number;
  escalatedCount: number;
  customerImpacted: number;
  preventable: number;
}

function resolutionRate(metric: IncidentMetric): number {
  if (metric.totalIncidents === 0) return 100;
  return Math.round((metric.resolvedIncidents / metric.totalIncidents) * 100);
}

function escalationRate(metric: IncidentMetric): number {
  if (metric.totalIncidents === 0) return 0;
  return Math.round((metric.escalatedCount / metric.totalIncidents) * 100);
}

function preventabilityRate(metric: IncidentMetric): number {
  if (metric.totalIncidents === 0) return 0;
  return Math.round((metric.preventable / metric.totalIncidents) * 100);
}

function isImproving(current: IncidentMetric, previous: IncidentMetric): boolean {
  return (
    resolutionRate(current) >= resolutionRate(previous) &&
    current.avgResolutionHours <= previous.avgResolutionHours
  );
}

function monthlyTrend(metrics: IncidentMetric[]): "improving" | "declining" | "stable" {
  if (metrics.length < 2) return "stable";
  const recent = metrics[metrics.length - 1];
  const prior  = metrics[metrics.length - 2];
  const rateChange = resolutionRate(recent) - resolutionRate(prior);
  if (rateChange > 5) return "improving";
  if (rateChange < -5) return "declining";
  return "stable";
}

function totalCustomersImpacted(metrics: IncidentMetric[]): number {
  return metrics.reduce((s, m) => s + m.customerImpacted, 0);
}

const METRICS: IncidentMetric[] = [
  { month: "2026-07", totalIncidents: 20, resolvedIncidents: 16, avgResolutionHours: 6,  escalatedCount: 4, customerImpacted: 50,  preventable: 8 },
  { month: "2026-08", totalIncidents: 18, resolvedIncidents: 15, avgResolutionHours: 5,  escalatedCount: 3, customerImpacted: 40,  preventable: 7 },
  { month: "2026-09", totalIncidents: 15, resolvedIncidents: 14, avgResolutionHours: 4,  escalatedCount: 2, customerImpacted: 30,  preventable: 5 },
];

describe("Incident metrics and KPI tracking", () => {
  it("resolutionRate: 14/15 = 93%", () => {
    expect(resolutionRate(METRICS[2])).toBe(93);
  });

  it("escalationRate: 2/15 = 13%", () => {
    expect(escalationRate(METRICS[2])).toBe(13);
  });

  it("preventabilityRate: 5/15 = 33%", () => {
    expect(preventabilityRate(METRICS[2])).toBe(33);
  });

  it("isImproving: Sep vs Aug → improving", () => {
    expect(isImproving(METRICS[2], METRICS[1])).toBe(true);
  });

  it("monthlyTrend: improving over 3 months", () => {
    expect(monthlyTrend(METRICS)).toBe("improving");
  });

  it("totalCustomersImpacted: 120 total", () => {
    expect(totalCustomersImpacted(METRICS)).toBe(120);
  });
});

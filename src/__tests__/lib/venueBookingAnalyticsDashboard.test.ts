/**
 * Tests for venue booking analytics dashboard widgets.
 */

interface DashboardMetric {
  metricKey: string;
  label: string;
  value: number;
  previousValue: number;
  unit: "count" | "currency" | "percent" | "hours";
  trend: "up" | "down" | "stable";
}

function calculateTrend(current: number, previous: number): "up" | "down" | "stable" {
  const changePct = previous > 0 ? ((current - previous) / previous) * 100 : 0;
  if (changePct > 5) return "up";
  if (changePct < -5) return "down";
  return "stable";
}

function formatMetricValue(metric: DashboardMetric): string {
  switch (metric.unit) {
    case "currency": return `$${(metric.value / 100).toFixed(2)}`;
    case "percent":  return `${metric.value}%`;
    case "hours":    return `${metric.value}h`;
    default:         return metric.value.toLocaleString();
  }
}

function changePercent(metric: DashboardMetric): number {
  if (metric.previousValue === 0) return metric.value > 0 ? 100 : 0;
  return Math.round(((metric.value - metric.previousValue) / metric.previousValue) * 100);
}

function buildDashboardMetrics(
  current: Record<string, number>,
  previous: Record<string, number>
): DashboardMetric[] {
  return Object.keys(current).map((key) => ({
    metricKey: key,
    label: key.replace(/_/g, " "),
    value: current[key],
    previousValue: previous[key] ?? 0,
    unit: key.includes("revenue") ? "currency" : key.includes("rate") ? "percent" : "count",
    trend: calculateTrend(current[key], previous[key] ?? 0),
  }));
}

const METRICS: DashboardMetric[] = [
  { metricKey: "bookings",     label: "Bookings",     value: 150,     previousValue: 120,    unit: "count",    trend: "up" },
  { metricKey: "revenue",      label: "Revenue",      value: 750_000, previousValue: 600_000,unit: "currency", trend: "up" },
  { metricKey: "cancel_rate",  label: "Cancel Rate",  value: 8,       previousValue: 12,     unit: "percent",  trend: "down" },
  { metricKey: "avg_duration", label: "Avg Duration", value: 4,       previousValue: 4,      unit: "hours",    trend: "stable" },
];

describe("Venue analytics dashboard", () => {
  it("calculateTrend: 25% growth → up", () => {
    expect(calculateTrend(150, 120)).toBe("up");
  });

  it("calculateTrend: -33% decline → down", () => {
    expect(calculateTrend(8, 12)).toBe("down");
  });

  it("calculateTrend: no change → stable", () => {
    expect(calculateTrend(4, 4)).toBe("stable");
  });

  it("formatMetricValue: currency → dollar format", () => {
    expect(formatMetricValue(METRICS[1])).toBe("$7500.00");
  });

  it("formatMetricValue: percent → percent string", () => {
    expect(formatMetricValue(METRICS[2])).toBe("8%");
  });

  it("changePercent: 150 from 120 = 25%", () => {
    expect(changePercent(METRICS[0])).toBe(25);
  });

  it("buildDashboardMetrics: creates metrics with trends", () => {
    const metrics = buildDashboardMetrics(
      { bookings: 150, revenue: 750000 },
      { bookings: 120, revenue: 600000 }
    );
    expect(metrics).toHaveLength(2);
    expect(metrics[0].trend).toBe("up");
  });
});

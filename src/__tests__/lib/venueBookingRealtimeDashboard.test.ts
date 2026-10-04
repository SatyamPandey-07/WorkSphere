/**
 * Tests for venue booking real-time dashboard metric computation.
 */

interface LiveMetric {
  name: string;
  value: number;
  previousValue: number;
  unit: "count" | "percent" | "currency" | "hours";
  updatedAt: number;
}

interface DashboardState {
  venueId: string;
  metrics: LiveMetric[];
  lastRefreshedAt: number;
  isStale: boolean;
}

function metricChange(metric: LiveMetric): number {
  return Math.round((metric.value - metric.previousValue) * 100) / 100;
}

function metricChangePercent(metric: LiveMetric): number | null {
  if (metric.previousValue === 0) return null;
  return Math.round(((metric.value - metric.previousValue) / metric.previousValue) * 100);
}

function isTrending(metric: LiveMetric, direction: "up" | "down"): boolean {
  const change = metricChange(metric);
  if (direction === "up") return change > 0;
  return change < 0;
}

function dashboardAge(state: DashboardState, nowMs: number): number {
  return Math.floor((nowMs - state.lastRefreshedAt) / 1000); // seconds
}

function staleDashboard(state: DashboardState, nowMs: number, maxAgeSeconds = 30): boolean {
  return dashboardAge(state, nowMs) > maxAgeSeconds;
}

function topMovers(metrics: LiveMetric[], limit = 3): LiveMetric[] {
  return [...metrics]
    .sort((a, b) => Math.abs(metricChange(b)) - Math.abs(metricChange(a)))
    .slice(0, limit);
}

const NOW = 1_700_000_000_000;
const DASHBOARD: DashboardState = {
  venueId: "v1", lastRefreshedAt: NOW - 15_000, isStale: false,
  metrics: [
    { name: "active_bookings",   value: 12,    previousValue: 10,    unit: "count",    updatedAt: NOW },
    { name: "today_revenue",     value: 8500,  previousValue: 7200,  unit: "currency", updatedAt: NOW },
    { name: "occupancy_rate",    value: 72,    previousValue: 68,    unit: "percent",  updatedAt: NOW },
    { name: "avg_response_time", value: 2.5,   previousValue: 3.2,   unit: "hours",    updatedAt: NOW },
  ],
};

describe("Real-time dashboard metric computation", () => {
  it("metricChange: active_bookings +2", () => {
    expect(metricChange(DASHBOARD.metrics[0])).toBe(2);
  });

  it("metricChangePercent: revenue +18%", () => {
    expect(metricChangePercent(DASHBOARD.metrics[1])).toBe(18);
  });

  it("isTrending: revenue trending up", () => {
    expect(isTrending(DASHBOARD.metrics[1], "up")).toBe(true);
  });

  it("isTrending: response time trending down", () => {
    expect(isTrending(DASHBOARD.metrics[3], "down")).toBe(true);
  });

  it("dashboardAge: 15 seconds old", () => {
    expect(dashboardAge(DASHBOARD, NOW)).toBe(15);
  });

  it("staleDashboard: 15s < 30s max → not stale", () => {
    expect(staleDashboard(DASHBOARD, NOW)).toBe(false);
  });

  it("topMovers: revenue has highest absolute change", () => {
    const movers = topMovers(DASHBOARD.metrics);
    expect(movers[0].name).toBe("today_revenue");
  });
});

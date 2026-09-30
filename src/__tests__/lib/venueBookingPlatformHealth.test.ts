/**
 * Tests for venue booking platform health monitoring.
 */

interface ServiceHealthMetric {
  serviceName: string;
  endpoint: string;
  latencyMs: number;
  errorRate: number;  // 0-1
  uptime: number;     // 0-1
  lastCheckedAt: number;
}

type HealthStatus = "healthy" | "degraded" | "unhealthy" | "unknown";

function serviceHealthStatus(metric: ServiceHealthMetric, nowMs: number): HealthStatus {
  const staleMs = 5 * 60_000; // 5 min stale
  if (nowMs - metric.lastCheckedAt > staleMs) return "unknown";
  if (metric.errorRate > 0.1 || metric.uptime < 0.95) return "unhealthy";
  if (metric.errorRate > 0.02 || metric.uptime < 0.99) return "degraded";
  return "healthy";
}

function overallPlatformStatus(metrics: ServiceHealthMetric[], nowMs: number): HealthStatus {
  if (metrics.length === 0) return "unknown";
  const statuses = metrics.map((m) => serviceHealthStatus(m, nowMs));
  if (statuses.includes("unhealthy")) return "unhealthy";
  if (statuses.includes("degraded")) return "degraded";
  if (statuses.includes("unknown")) return "unknown";
  return "healthy";
}

function avgLatency(metrics: ServiceHealthMetric[]): number {
  if (metrics.length === 0) return 0;
  return Math.round(metrics.reduce((s, m) => s + m.latencyMs, 0) / metrics.length);
}

function alertingServices(metrics: ServiceHealthMetric[], nowMs: number): string[] {
  return metrics
    .filter((m) => ["degraded", "unhealthy"].includes(serviceHealthStatus(m, nowMs)))
    .map((m) => m.serviceName);
}

const NOW = 1_700_000_000_000;
const METRICS: ServiceHealthMetric[] = [
  { serviceName: "API Gateway",  endpoint: "/api",      latencyMs: 45,  errorRate: 0.001, uptime: 0.999, lastCheckedAt: NOW - 60_000  },
  { serviceName: "Payment Svc",  endpoint: "/payments", latencyMs: 200, errorRate: 0.05,  uptime: 0.97,  lastCheckedAt: NOW - 120_000 },
  { serviceName: "Booking Svc",  endpoint: "/bookings", latencyMs: 80,  errorRate: 0.01,  uptime: 0.999, lastCheckedAt: NOW - 30_000  },
  { serviceName: "Stale Service",endpoint: "/stale",    latencyMs: 50,  errorRate: 0.001, uptime: 0.999, lastCheckedAt: NOW - 400_000 }, // stale
];

describe("Platform health monitoring", () => {
  it("serviceHealthStatus: healthy service", () => {
    expect(serviceHealthStatus(METRICS[0], NOW)).toBe("healthy");
  });

  it("serviceHealthStatus: high error rate → unhealthy", () => {
    expect(serviceHealthStatus(METRICS[1], NOW)).toBe("unhealthy");
  });

  it("serviceHealthStatus: stale data → unknown", () => {
    expect(serviceHealthStatus(METRICS[3], NOW)).toBe("unknown");
  });

  it("overallPlatformStatus: any unhealthy → unhealthy", () => {
    expect(overallPlatformStatus(METRICS, NOW)).toBe("unhealthy");
  });

  it("overallPlatformStatus: all healthy → healthy", () => {
    const allHealthy = [METRICS[0], METRICS[2]];
    expect(overallPlatformStatus(allHealthy, NOW)).toBe("healthy");
  });

  it("avgLatency: (45+200+80+50)/4 ≈ 93ms", () => {
    expect(avgLatency(METRICS)).toBeCloseTo(93, 0);
  });

  it("alertingServices: Payment Svc alerting", () => {
    const alerts = alertingServices(METRICS, NOW);
    expect(alerts).toContain("Payment Svc");
    expect(alerts).not.toContain("API Gateway");
  });
});

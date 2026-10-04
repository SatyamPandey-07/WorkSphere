/**
 * Tests for venue booking platform health check utilities.
 */

type ServiceStatus = "healthy" | "degraded" | "down" | "unknown";
type ServiceName = "database" | "cache" | "payment_gateway" | "email" | "storage" | "search";

interface ServiceHealth {
  name: ServiceName;
  status: ServiceStatus;
  latencyMs: number;
  lastCheckedAt: number;
  errorRate: number;    // 0-1
  uptime: number;       // 0-1 for current period
}

interface PlatformHealth {
  services: ServiceHealth[];
  overallStatus: ServiceStatus;
  checkedAt: number;
}

function serviceStatusScore(service: ServiceHealth): number {
  if (service.status === "down") return 0;
  if (service.status === "degraded") return 50;
  if (service.status === "healthy") return 100;
  return 25;
}

function overallHealth(services: ServiceHealth[]): ServiceStatus {
  const hasDown     = services.some((s) => s.status === "down");
  const hasDegraded = services.some((s) => s.status === "degraded");
  if (hasDown) return "down";
  if (hasDegraded) return "degraded";
  return "healthy";
}

function criticalServices(services: ServiceHealth[]): ServiceHealth[] {
  const critical: ServiceName[] = ["database", "payment_gateway"];
  return services.filter((s) => critical.includes(s.name) && s.status !== "healthy");
}

function avgLatencyMs(services: ServiceHealth[]): number {
  if (services.length === 0) return 0;
  return Math.round(services.reduce((s, svc) => s + svc.latencyMs, 0) / services.length);
}

function highErrorRateServices(services: ServiceHealth[], threshold = 0.05): ServiceHealth[] {
  return services.filter((s) => s.errorRate > threshold);
}

function isStale(service: ServiceHealth, nowMs: number, maxAgeMs = 60_000): boolean {
  return nowMs - service.lastCheckedAt > maxAgeMs;
}

const NOW = 1_700_000_000_000;
const SERVICES: ServiceHealth[] = [
  { name: "database",       status: "healthy",  latencyMs: 5,   lastCheckedAt: NOW - 10_000, errorRate: 0.001, uptime: 0.999 },
  { name: "cache",          status: "healthy",  latencyMs: 1,   lastCheckedAt: NOW - 5_000,  errorRate: 0,     uptime: 1 },
  { name: "payment_gateway",status: "degraded", latencyMs: 800, lastCheckedAt: NOW - 15_000, errorRate: 0.08,  uptime: 0.95 },
  { name: "email",          status: "healthy",  latencyMs: 50,  lastCheckedAt: NOW - 20_000, errorRate: 0.01,  uptime: 0.998 },
];

describe("Platform health check utilities", () => {
  it("overallHealth: degraded service → degraded overall", () => {
    expect(overallHealth(SERVICES)).toBe("degraded");
  });

  it("overallHealth: all healthy → healthy", () => {
    const allHealthy = SERVICES.map((s) => ({ ...s, status: "healthy" as ServiceStatus }));
    expect(overallHealth(allHealthy)).toBe("healthy");
  });

  it("criticalServices: payment_gateway is degraded critical service", () => {
    const critical = criticalServices(SERVICES);
    expect(critical.map((s) => s.name)).toContain("payment_gateway");
  });

  it("avgLatencyMs: (5+1+800+50)/4 = 214", () => {
    expect(avgLatencyMs(SERVICES)).toBe(214);
  });

  it("highErrorRateServices: payment_gateway at 8% error rate", () => {
    const high = highErrorRateServices(SERVICES);
    expect(high.map((s) => s.name)).toContain("payment_gateway");
  });

  it("isStale: service checked 2 minutes ago → stale", () => {
    expect(isStale(SERVICES[0], NOW + 110_000)).toBe(true);
  });
});

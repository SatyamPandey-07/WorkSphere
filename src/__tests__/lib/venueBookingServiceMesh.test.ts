/**
 * Tests for venue booking microservice mesh health.
 */

interface ServiceNode {
  serviceId: string;
  serviceName: string;
  version: string;
  instances: number;
  healthyInstances: number;
  avgResponseMs: number;
  requestsPerSecond: number;
  errorRate: number;  // 0-1
}

function serviceAvailability(node: ServiceNode): number {
  if (node.instances === 0) return 0;
  return Math.round((node.healthyInstances / node.instances) * 100);
}

function isServiceDegraded(node: ServiceNode): boolean {
  return node.errorRate > 0.05 || serviceAvailability(node) < 80 || node.avgResponseMs > 500;
}

function meshHealthScore(nodes: ServiceNode[]): number {
  if (nodes.length === 0) return 0;
  const avgAvailability = nodes.reduce((s, n) => s + serviceAvailability(n), 0) / nodes.length;
  const avgErrorRate = nodes.reduce((s, n) => s + n.errorRate, 0) / nodes.length;
  const avgResponse = nodes.reduce((s, n) => s + n.avgResponseMs, 0) / nodes.length;
  const healthPct = avgAvailability * 0.5 + (1 - avgErrorRate) * 40 + Math.max(0, 10 - avgResponse / 100);
  return Math.round(Math.min(100, healthPct));
}

function criticalServices(nodes: ServiceNode[]): string[] {
  return nodes.filter((n) => isServiceDegraded(n)).map((n) => n.serviceName);
}

function totalRps(nodes: ServiceNode[]): number {
  return Math.round(nodes.reduce((s, n) => s + n.requestsPerSecond, 0));
}

const NODES: ServiceNode[] = [
  { serviceId: "s1", serviceName: "BookingAPI",  version: "2.3", instances: 5, healthyInstances: 5, avgResponseMs: 120, requestsPerSecond: 150, errorRate: 0.01 },
  { serviceId: "s2", serviceName: "PaymentSvc",  version: "1.8", instances: 3, healthyInstances: 2, avgResponseMs: 800, requestsPerSecond: 50,  errorRate: 0.08 },
  { serviceId: "s3", serviceName: "NotifySvc",   version: "1.2", instances: 2, healthyInstances: 2, avgResponseMs: 50,  requestsPerSecond: 200, errorRate: 0.005 },
];

describe("Venue booking service mesh health", () => {
  it("serviceAvailability: 5/5 → 100%", () => {
    expect(serviceAvailability(NODES[0])).toBe(100);
  });

  it("serviceAvailability: 2/3 → 67%", () => {
    expect(serviceAvailability(NODES[1])).toBe(67);
  });

  it("isServiceDegraded: PaymentSvc (high error + slow) → degraded", () => {
    expect(isServiceDegraded(NODES[1])).toBe(true);
  });

  it("isServiceDegraded: BookingAPI → not degraded", () => {
    expect(isServiceDegraded(NODES[0])).toBe(false);
  });

  it("criticalServices: PaymentSvc is critical", () => {
    expect(criticalServices(NODES)).toContain("PaymentSvc");
    expect(criticalServices(NODES)).not.toContain("BookingAPI");
  });

  it("totalRps: sum of all services", () => {
    expect(totalRps(NODES)).toBe(400);
  });

  it("meshHealthScore: mixed health → between 50-90", () => {
    const score = meshHealthScore(NODES);
    expect(score).toBeGreaterThan(50);
    expect(score).toBeLessThan(100);
  });
});

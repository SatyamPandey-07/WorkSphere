/**
 * Tests for venue WiFi speed test result analysis.
 */

interface SpeedTestResult {
  testId: string;
  venueId: string;
  testedAt: number;
  downloadMbps: number;
  uploadMbps: number;
  latencyMs: number;
  jitterMs: number;
  testServerId: string;
}

function latestSpeedTest(results: SpeedTestResult[], venueId: string): SpeedTestResult | null {
  const venue = results.filter((r) => r.venueId === venueId);
  if (venue.length === 0) return null;
  return venue.reduce((latest, r) => r.testedAt > latest.testedAt ? r : latest);
}

function averageDownloadMbps(results: SpeedTestResult[], venueId: string): number {
  const venue = results.filter((r) => r.venueId === venueId);
  if (venue.length === 0) return 0;
  return Math.round(venue.reduce((s, r) => s + r.downloadMbps, 0) / venue.length * 10) / 10;
}

function isSpeedAcceptableForVideoCall(result: SpeedTestResult): boolean {
  return result.downloadMbps >= 5 && result.uploadMbps >= 2 && result.latencyMs <= 100;
}

function speedConsistency(results: SpeedTestResult[], venueId: string): number {
  const venue = results.filter((r) => r.venueId === venueId);
  if (venue.length < 2) return 100;
  const avg = averageDownloadMbps(results, venueId);
  const variance = venue.reduce((sum, r) => sum + (r.downloadMbps - avg) ** 2, 0) / venue.length;
  const stdDev = Math.sqrt(variance);
  const cv = avg > 0 ? (stdDev / avg) * 100 : 100;
  return Math.round(Math.max(0, 100 - cv));
}

const NOW = 1_700_000_000_000;
const RESULTS: SpeedTestResult[] = [
  { testId: "t1", venueId: "v1", testedAt: NOW - 3600_000, downloadMbps: 80,  uploadMbps: 20, latencyMs: 10, jitterMs: 2, testServerId: "s1" },
  { testId: "t2", venueId: "v1", testedAt: NOW - 1800_000, downloadMbps: 90,  uploadMbps: 25, latencyMs: 8,  jitterMs: 1, testServerId: "s1" },
  { testId: "t3", venueId: "v1", testedAt: NOW - 900_000,  downloadMbps: 85,  uploadMbps: 22, latencyMs: 12, jitterMs: 3, testServerId: "s1" },
  { testId: "t4", venueId: "v2", testedAt: NOW - 100_000,  downloadMbps: 3,   uploadMbps: 1,  latencyMs: 200,jitterMs: 20,testServerId: "s2" },
];

describe("Venue WiFi speed test analysis", () => {
  it("latestSpeedTest: most recent for v1", () => {
    expect(latestSpeedTest(RESULTS, "v1")!.testId).toBe("t3");
  });

  it("latestSpeedTest: unknown venue → null", () => {
    expect(latestSpeedTest(RESULTS, "v99")).toBeNull();
  });

  it("averageDownloadMbps: v1 = (80+90+85)/3 ≈ 85", () => {
    expect(averageDownloadMbps(RESULTS, "v1")).toBeCloseTo(85, 0);
  });

  it("isSpeedAcceptableForVideoCall: v1 result → true", () => {
    expect(isSpeedAcceptableForVideoCall(RESULTS[0])).toBe(true);
  });

  it("isSpeedAcceptableForVideoCall: v2 (slow) → false", () => {
    expect(isSpeedAcceptableForVideoCall(RESULTS[3])).toBe(false);
  });

  it("speedConsistency: single result → 100%", () => {
    expect(speedConsistency([RESULTS[0]], "v1")).toBe(100);
  });

  it("speedConsistency: v1 consistent speeds → high score", () => {
    expect(speedConsistency(RESULTS, "v1")).toBeGreaterThan(70);
  });
});

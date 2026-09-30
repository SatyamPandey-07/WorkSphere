/**
 * Tests for venue network connectivity signal strength classification.
 */

type NetworkType = "wifi" | "4g" | "5g" | "ethernet";

interface NetworkSignal {
  type: NetworkType;
  signalStrength: number; // 0-100
  downloadMbps: number;
  uploadMbps: number;
  latencyMs: number;
}

type SignalQuality = "poor" | "fair" | "good" | "excellent";

function classifySignalQuality(signal: NetworkSignal): SignalQuality {
  const score = signal.signalStrength;
  if (score >= 80) return "excellent";
  if (score >= 60) return "good";
  if (score >= 30) return "fair";
  return "poor";
}

function meetsVideoCallRequirements(signal: NetworkSignal): boolean {
  return signal.downloadMbps >= 5 && signal.uploadMbps >= 2 && signal.latencyMs <= 100;
}

function meets4KStreamingRequirements(signal: NetworkSignal): boolean {
  return signal.downloadMbps >= 25 && signal.latencyMs <= 50;
}

function networkScore(signal: NetworkSignal): number {
  const download = Math.min(signal.downloadMbps / 100, 1) * 40;
  const upload = Math.min(signal.uploadMbps / 50, 1) * 20;
  const latency = Math.max(0, (200 - signal.latencyMs) / 200) * 20;
  const strength = (signal.signalStrength / 100) * 20;
  return Math.round(download + upload + latency + strength);
}

const EXCELLENT: NetworkSignal = { type: "wifi", signalStrength: 90, downloadMbps: 200, uploadMbps: 100, latencyMs: 5 };
const POOR: NetworkSignal      = { type: "4g",   signalStrength: 20, downloadMbps: 2,   uploadMbps: 1,   latencyMs: 150 };

describe("Venue network signal", () => {
  it("classifySignalQuality: 90% → excellent", () => {
    expect(classifySignalQuality(EXCELLENT)).toBe("excellent");
  });

  it("classifySignalQuality: 20% → poor", () => {
    expect(classifySignalQuality(POOR)).toBe("poor");
  });

  it("classifySignalQuality: 65% → good", () => {
    const good: NetworkSignal = { ...POOR, signalStrength: 65 };
    expect(classifySignalQuality(good)).toBe("good");
  });

  it("meetsVideoCallRequirements: excellent → true", () => {
    expect(meetsVideoCallRequirements(EXCELLENT)).toBe(true);
  });

  it("meetsVideoCallRequirements: poor upload → false", () => {
    expect(meetsVideoCallRequirements(POOR)).toBe(false);
  });

  it("meets4KStreamingRequirements: 200Mbps, 5ms → true", () => {
    expect(meets4KStreamingRequirements(EXCELLENT)).toBe(true);
  });

  it("meets4KStreamingRequirements: high latency → false", () => {
    expect(meets4KStreamingRequirements({ ...EXCELLENT, latencyMs: 80 })).toBe(false);
  });

  it("networkScore: excellent > poor", () => {
    expect(networkScore(EXCELLENT)).toBeGreaterThan(networkScore(POOR));
  });

  it("networkScore: max is 100", () => {
    expect(networkScore(EXCELLENT)).toBeLessThanOrEqual(100);
  });
});

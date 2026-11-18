import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import ProofOfBandwidthModal, {
  formatJitter,
} from "@/components/wifi/ProofOfBandwidthModal";

const mockMetricsRef: { current: Record<string, unknown> } = { current: {} };

jest.mock("@/lib/wifi/speedBenchmarkEngine", () => ({
  SpeedBenchmarkRunner: class {
    async runBenchmark() {
      return mockMetricsRef.current;
    }
    cancel() {}
  },
}));

const baseMetrics = {
  downloadMbps: 52.3,
  uploadMbps: 18.4,
  latencyMs: 28.5,
  jitterMs: 1.1,
  meanJitterMs: 4.2,
  packetLossPct: 0,
  stabilityScore: 92,
  tier: "4K_CONFERENCING",
  timestamp: "2026-10-13T00:00:00.000Z",
};

describe("formatJitter", () => {
  it("formats with one decimal", () => {
    expect(formatJitter(4.24)).toBe("4.2");
    expect(formatJitter(0)).toBe("0.0");
    expect(formatJitter(12)).toBe("12.0");
  });

  it("returns -- for missing or invalid values", () => {
    expect(formatJitter(null)).toBe("--");
    expect(formatJitter(undefined)).toBe("--");
    expect(formatJitter(NaN)).toBe("--");
    expect(formatJitter(-1)).toBe("--");
  });
});

describe("ProofOfBandwidthModal jitter tile", () => {
  beforeEach(() => {
    mockMetricsRef.current = baseMetrics;
    global.fetch = jest.fn().mockResolvedValue({
      json: async () => ({ success: false }),
    }) as unknown as typeof fetch;
  });

  it("shows the Jitter tile with no value before a benchmark has run", () => {
    render(<ProofOfBandwidthModal />);
    expect(screen.getByText("Jitter")).toBeInTheDocument();
    expect(screen.queryByText("4.2 ms")).not.toBeInTheDocument();
  });

  it("shows the mean jitter and the RFC 3550 value after a benchmark", async () => {
    render(<ProofOfBandwidthModal />);
    fireEvent.click(screen.getByRole("button", { name: /run benchmark/i }));

    await waitFor(() => expect(screen.getByText("4.2 ms")).toBeInTheDocument());
    expect(screen.getByText("RFC 3550: \u00b11.1 ms")).toBeInTheDocument();
  });

  it("shows no mean jitter when it could not be computed", async () => {
    mockMetricsRef.current = { ...baseMetrics, meanJitterMs: null };
    render(<ProofOfBandwidthModal />);
    fireEvent.click(screen.getByRole("button", { name: /run benchmark/i }));

    await waitFor(() =>
      expect(screen.getByText("RFC 3550: \u00b11.1 ms")).toBeInTheDocument(),
    );
    expect(screen.queryByText("4.2 ms")).not.toBeInTheDocument();
  });
});

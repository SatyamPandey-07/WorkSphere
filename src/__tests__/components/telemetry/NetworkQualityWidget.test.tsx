import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  NetworkQualityWidget,
  calculateMedian,
  calculateJitter,
  calculatePacketLoss,
  getNetworkQualityGrade,
} from "@/components/telemetry/NetworkQualityWidget";

describe("Network Quality Calculations", () => {
  describe("calculateMedian", () => {
    it("returns 0 for empty arrays", () => {
      expect(calculateMedian([])).toBe(0);
    });

    it("returns middle element for odd-length arrays", () => {
      expect(calculateMedian([30, 10, 20])).toBe(20);
      expect(calculateMedian([5])).toBe(5);
    });

    it("returns average of middle two elements for even-length arrays", () => {
      expect(calculateMedian([40, 10, 30, 20])).toBe(25);
      expect(calculateMedian([12, 14])).toBe(13);
    });
  });

  describe("calculateJitter", () => {
    it("returns 0 when fewer than 2 samples are provided", () => {
      expect(calculateJitter([])).toBe(0);
      expect(calculateJitter([25])).toBe(0);
    });

    it("computes mean difference between consecutive samples", () => {
      // Samples: [20, 25, 22, 28]
      // Diffs: |25-20|=5, |22-25|=3, |28-22|=6
      // Sum = 14, Count = 3 -> 14/3 = 4.666... -> 4.7
      expect(calculateJitter([20, 25, 22, 28])).toBe(4.7);
    });
  });

  describe("calculatePacketLoss", () => {
    it("returns 0% for empty samples", () => {
      expect(calculatePacketLoss([])).toBe(0);
    });

    it("computes packet loss percentage within rolling 60-second window", () => {
      const now = 1700000000000;
      const samples = [
        { timestamp: now - 10000, rttMs: 20 },
        { timestamp: now - 8000, rttMs: null, lost: true }, // lost
        { timestamp: now - 5000, rttMs: 25 },
        { timestamp: now - 2000, rttMs: 22 },
        // Sample outside 60s window (should be ignored)
        { timestamp: now - 80000, rttMs: null, lost: true },
      ];

      // 4 samples in window, 1 lost -> 25.0%
      expect(calculatePacketLoss(samples, 60000, now)).toBe(25.0);
    });
  });

  describe("getNetworkQualityGrade", () => {
    it("grades Excellent when <30ms RTT and <5ms jitter", () => {
      const result = getNetworkQualityGrade(22, 2.5, 0);
      expect(result.grade).toBe("Excellent");
      expect(result.label).toContain("<30ms");
    });

    it("grades Good when RTT is 30-80ms", () => {
      const result = getNetworkQualityGrade(45, 6, 0);
      expect(result.grade).toBe("Good");
      expect(result.label).toContain("30-80ms");
    });

    it("grades Fair when RTT is 80-150ms", () => {
      const result = getNetworkQualityGrade(110, 8, 1);
      expect(result.grade).toBe("Fair");
      expect(result.label).toContain("80-150ms");
    });

    it("grades Poor when RTT > 150ms", () => {
      const result = getNetworkQualityGrade(180, 15, 2);
      expect(result.grade).toBe("Poor");
      expect(result.label).toContain(">150ms");
    });
  });
});

describe("NetworkQualityWidget Component", () => {
  beforeEach(() => {
    window.URL.createObjectURL = jest.fn(() => "blob:http://localhost/test-blob");
    window.URL.revokeObjectURL = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("renders key metrics and Excellent grade badge", () => {
    const samples = [
      { timestamp: Date.now() - 3000, rttMs: 18 },
      { timestamp: Date.now() - 2000, rttMs: 20 },
      { timestamp: Date.now() - 1000, rttMs: 22 },
    ];

    render(
      <NetworkQualityWidget
        samples={samples}
        initialMedianRtt={20}
        initialJitter={2}
        initialPacketLoss={0}
        venueName="Central Lab"
      />,
    );

    expect(screen.getByTestId("network-quality-widget")).toBeInTheDocument();
    expect(screen.getByText("Network Latency & Jitter")).toBeInTheDocument();
    expect(screen.getByTestId("network-quality-badge")).toHaveTextContent(
      "Excellent",
    );
    expect(screen.getByTestId("metric-median-rtt")).toHaveTextContent("20ms");
    expect(screen.getByTestId("metric-jitter")).toHaveTextContent("±2ms");
    expect(screen.getByTestId("metric-packet-loss")).toHaveTextContent("0%");
  });

  it("renders Poor grade when latency exceeds 150ms", () => {
    render(
      <NetworkQualityWidget
        initialMedianRtt={185}
        initialJitter={12}
        initialPacketLoss={12}
      />,
    );

    expect(screen.getByTestId("network-quality-badge")).toHaveTextContent("Poor");
  });

  it("handles Download Diagnostics button and exports formatted JSON", () => {
    const onDownloadDiagnostics = jest.fn();
    const clickSpy = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation();

    render(
      <NetworkQualityWidget
        venueId="venue-sf-01"
        venueName="Code Co-op"
        initialMedianRtt={25}
        initialJitter={3}
        initialPacketLoss={0}
        connectionType="wifi"
        onDownloadDiagnostics={onDownloadDiagnostics}
      />,
    );

    const downloadBtn = screen.getByRole("button", {
      name: /download diagnostics/i,
    });
    expect(downloadBtn).toBeInTheDocument();

    fireEvent.click(downloadBtn);

    expect(onDownloadDiagnostics).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionType: "wifi",
        venueId: "venue-sf-01",
        venueName: "Code Co-op",
        telemetryMetrics: expect.objectContaining({
          medianRttMs: 25,
          jitterMs: 3,
          packetLossPercentage: 0,
          qualityGrade: "Excellent",
        }),
      }),
    );

    expect(window.URL.createObjectURL).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();
    expect(window.URL.revokeObjectURL).toHaveBeenCalled();
  });
});

import React from "react";
import { render, screen } from "@testing-library/react";
import {
  TacticalTelemetryGForceGraph,
  calculateGForceLoad,
  classifyLoad,
  G_LOAD_LIMITS,
} from "@/components/admin/TacticalTelemetryGForceGraph";

describe("TacticalTelemetryGForceGraph Component and Utilities", () => {
  describe("calculateGForceLoad", () => {
    it("returns nominal 1G for healthy 60fps idle conditions with zero latency", () => {
      const load = calculateGForceLoad(60, 0, 0);
      expect(load).toBeCloseTo(G_LOAD_LIMITS.nominal, 1);
    });

    it("adds dynamic scroll load up to +2G at saturation velocity", () => {
      const load = calculateGForceLoad(60, 3, 0);
      // 1G baseline + 2G scroll = 3G
      expect(load).toBeCloseTo(3.0, 1);
    });

    it("increases load toward redline (+9G) during frame-drop stalls", () => {
      const stallLoad = calculateGForceLoad(10, 0, 0);
      expect(stallLoad).toBeGreaterThanOrEqual(6.0);

      const severeStall = calculateGForceLoad(0, 0, 0);
      expect(severeStall).toBeCloseTo(G_LOAD_LIMITS.maxPositive, 1);
    });

    it("unloads into negative G during severe input latency (>200ms)", () => {
      const deepLag = calculateGForceLoad(60, 0, 700);
      // 1G baseline - 3G latency = -2G
      expect(deepLag).toBeLessThan(0);
      expect(deepLag).toBeGreaterThanOrEqual(G_LOAD_LIMITS.maxNegative);
    });

    it("sanitizes NaN, non-finite, and negative inputs gracefully", () => {
      const nanLoad = calculateGForceLoad(NaN, NaN, NaN);
      expect(nanLoad).toBeCloseTo(1.0, 1);

      const infLoad = calculateGForceLoad(Infinity, Infinity, Infinity);
      expect(infLoad).toBeLessThanOrEqual(G_LOAD_LIMITS.maxPositive);

      const negLoad = calculateGForceLoad(-60, -5, -20);
      expect(Number.isFinite(negLoad)).toBe(true);
    });
  });

  describe("classifyLoad", () => {
    it("classifies load into proper structural severity buckets", () => {
      expect(classifyLoad(-1.5)).toBe("stalled");
      expect(classifyLoad(1.0)).toBe("nominal");
      expect(classifyLoad(3.5)).toBe("elevated");
      expect(classifyLoad(8.0)).toBe("critical");
    });

    it("safely classifies non-finite load to nominal", () => {
      expect(classifyLoad(NaN)).toBe("nominal");
      expect(classifyLoad(Infinity)).toBe("nominal");
    });
  });

  describe("TacticalTelemetryGForceGraph Component", () => {
    it("renders SVG flight envelope with axis labels and load readouts", () => {
      render(
        <TacticalTelemetryGForceGraph
          fps={60}
          scrollVelocity={1.5}
          latencyMs={25}
          title="Flight Telemetry HUD"
        />,
      );

      expect(screen.getByTestId("tactical-telemetry-gforce-graph")).toBeInTheDocument();
      expect(screen.getByText("Flight Telemetry HUD")).toBeInTheDocument();
      expect(screen.getByTestId("load-marker-line")).toBeInTheDocument();
      expect(screen.getByTestId("load-marker-pip")).toBeInTheDocument();

      // Readouts
      expect(screen.getByTestId("gforce-load-readout")).toHaveTextContent(/2\.\dG/);
      expect(screen.getByTestId("telemetry-summary-readout")).toHaveTextContent(
        "60 FPS · 1.5 px/ms · 25 ms latency",
      );
    });

    it("sanitizes NaN and negative telemetry props without rendering invalid SVG coordinates", () => {
      render(
        <TacticalTelemetryGForceGraph
          fps={NaN}
          scrollVelocity={NaN}
          latencyMs={NaN}
        />,
      );

      const line = screen.getByTestId("load-marker-line");
      const pip = screen.getByTestId("load-marker-pip");

      // Verify coordinate attributes are valid finite numbers, not NaN
      expect(line.getAttribute("y1")).not.toBe("NaN");
      expect(line.getAttribute("y2")).not.toBe("NaN");
      expect(pip.getAttribute("cy")).not.toBe("NaN");

      expect(screen.getByTestId("gforce-load-readout")).toHaveTextContent("1.0G");
      expect(screen.getByTestId("telemetry-summary-readout")).toHaveTextContent(
        "60 FPS · 0.0 px/ms · 0 ms latency",
      );
    });

    it("handles extreme negative latency gracefully", () => {
      render(
        <TacticalTelemetryGForceGraph
          fps={120}
          scrollVelocity={0}
          latencyMs={-50}
        />,
      );

      expect(screen.getByTestId("gforce-load-readout")).toHaveTextContent("1.0G");
      expect(screen.getByTestId("telemetry-summary-readout")).toHaveTextContent(
        "120 FPS · 0.0 px/ms · 0 ms latency",
      );
    });
  });
});

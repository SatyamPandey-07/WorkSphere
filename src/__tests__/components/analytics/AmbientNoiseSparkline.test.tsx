import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  AmbientNoiseSparkline,
  generateCubicBezierPath,
  formatHour,
  getNoiseLevelCategory,
  HourlyDecibelPoint,
} from "@/components/analytics/AmbientNoiseSparkline";

describe("AmbientNoiseSparkline Component & Helpers", () => {
  describe("generateCubicBezierPath", () => {
    it("returns empty string for empty points array", () => {
      expect(generateCubicBezierPath([])).toBe("");
    });

    it("returns single Move command for single point", () => {
      expect(generateCubicBezierPath([{ x: 10, y: 20 }])).toBe("M 10.0 20.0");
    });

    it("generates smooth SVG cubic Bézier path with M... C... format", () => {
      const points = [
        { x: 10, y: 50 },
        { x: 50, y: 30 },
        { x: 90, y: 70 },
      ];
      const path = generateCubicBezierPath(points);

      expect(path.startsWith("M 10.0 50.0")).toBe(true);
      expect(path).toContain("C");
      // Matches M ... C ... C ...
      expect(path).toMatch(/^M\s+[\d.-]+\s+[\d.-]+(?:\s+C\s+[\d.,\s-]+)+$/);
    });
  });

  describe("formatHour", () => {
    it("formats hours into 12-hour AM/PM notation", () => {
      expect(formatHour(0)).toBe("12:00 AM");
      expect(formatHour(9)).toBe("9:00 AM");
      expect(formatHour(12)).toBe("12:00 PM");
      expect(formatHour(14)).toBe("2:00 PM");
      expect(formatHour(23)).toBe("11:00 PM");
    });
  });

  describe("getNoiseLevelCategory", () => {
    it("returns Quiet Focus for <45 dBA", () => {
      const cat = getNoiseLevelCategory(38);
      expect(cat.label).toBe("Quiet Focus");
      expect(cat.color).toContain("emerald");
    });

    it("returns Moderate Buzz for 45-65 dBA", () => {
      const cat = getNoiseLevelCategory(55);
      expect(cat.label).toBe("Moderate Buzz");
      expect(cat.color).toContain("amber");
    });

    it("returns Lively / Loud for >65 dBA", () => {
      const cat = getNoiseLevelCategory(72);
      expect(cat.label).toBe("Lively / Loud");
      expect(cat.color).toContain("rose");
    });
  });

  describe("AmbientNoiseSparkline Rendering & Hover Tooltip", () => {
    const mockHourlyDecibels: HourlyDecibelPoint[] = [
      { hour: 8, dBA: 42 }, // Quiet (<45)
      { hour: 12, dBA: 70 }, // Loud (>65)
      { hour: 16, dBA: 55 }, // Moderate (45-65)
    ];

    it("renders SVG with cubic Bézier path and vertical linear gradient", () => {
      const { container } = render(
        <AmbientNoiseSparkline
          hourlyDecibels={mockHourlyDecibels}
          width={300}
          height={100}
        />,
      );

      expect(screen.getByTestId("ambient-noise-sparkline")).toBeInTheDocument();
      expect(screen.getByTestId("ambient-noise-svg")).toBeInTheDocument();

      const bezierPath = screen.getByTestId("sparkline-bezier-path");
      expect(bezierPath).toBeInTheDocument();
      expect(bezierPath.getAttribute("d")).toMatch(/^M\s+[\d.-]+\s+[\d.-]+\s+C/);
      expect(bezierPath.getAttribute("stroke")).toContain("noiseLevelGradient");

      // Verify vertical linear gradient exists with green, yellow, and red stops
      const gradient = container.querySelector("#noiseLevelGradient");
      expect(gradient).toBeInTheDocument();
      expect(gradient?.getAttribute("y1")).toBe("0%");
      expect(gradient?.getAttribute("y2")).toBe("100%");

      const stops = gradient?.querySelectorAll("stop");
      expect(stops && stops.length >= 3).toBe(true);

      const stopColors = Array.from(stops || []).map((s) =>
        s.getAttribute("stopColor"),
      );
      // Red at top (>65), yellow middle (45-65), green at bottom (<45)
      expect(stopColors).toContain("#ef4444");
      expect(stopColors).toContain("#f59e0b");
      expect(stopColors).toContain("#10b981");
    });

    it("renders interactive hover tooltip displaying hour and recorded dBA level on hover", () => {
      render(
        <AmbientNoiseSparkline
          hourlyDecibels={mockHourlyDecibels}
          width={300}
          height={100}
        />,
      );

      const svg = screen.getByTestId("ambient-noise-svg");

      // Initially, no tooltip is visible
      expect(screen.queryByTestId("sparkline-tooltip")).not.toBeInTheDocument();

      // Mock getBoundingClientRect
      jest.spyOn(svg, "getBoundingClientRect").mockReturnValue({
        left: 0,
        top: 0,
        width: 300,
        height: 100,
        right: 300,
        bottom: 100,
        x: 0,
        y: 0,
        toJSON: () => {},
      });

      // Hover over middle point (hour 12, 70 dBA) at relativeX ~150
      fireEvent.pointerMove(svg, {
        clientX: 150,
        clientY: 30,
      });

      const tooltip = screen.getByTestId("sparkline-tooltip");
      expect(tooltip).toBeInTheDocument();
      expect(tooltip).toHaveAttribute("data-hour", "12");
      expect(tooltip).toHaveAttribute("data-dba", "70");
      expect(tooltip).toHaveTextContent("12:00 PM");
      expect(tooltip).toHaveTextContent("70dBA");
      expect(tooltip).toHaveTextContent("Lively / Loud");

      // Hover off SVG
      fireEvent.pointerLeave(svg);
      expect(screen.queryByTestId("sparkline-tooltip")).not.toBeInTheDocument();
    });

    it("renders default baseline data when hourlyDecibels is not passed", () => {
      render(<AmbientNoiseSparkline />);

      expect(screen.getByTestId("ambient-noise-sparkline")).toBeInTheDocument();
      expect(screen.getByTestId("sparkline-bezier-path")).toBeInTheDocument();
      expect(screen.getByText("12 AM")).toBeInTheDocument();
      expect(screen.getByText("11 PM")).toBeInTheDocument();
    });
  });
});

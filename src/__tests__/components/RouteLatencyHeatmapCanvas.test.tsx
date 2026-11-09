import React from "react";
import { render, screen } from "@testing-library/react";
import { RouteLatencyHeatmapCanvas } from "@/components/admin/RouteLatencyHeatmapCanvas";

describe("RouteLatencyHeatmapCanvas", () => {
  it("renders canvas element with proper accessibility attributes", () => {
    const points = [
      { x: 0.1, y: 0.2, latency: 0.15 },
      { x: 0.5, y: 0.5, latency: 0.65 },
      { x: 0.8, y: 0.9, latency: 0.95 },
    ];

    render(
      <RouteLatencyHeatmapCanvas points={points} width={800} height={500} />,
    );
    const canvas = screen.getByRole("img", {
      name: /Route Latency Heatmap Geo Visualization/i,
    });
    expect(canvas).toBeInTheDocument();
    expect(canvas).toHaveAttribute("width", "800");
    expect(canvas).toHaveAttribute("height", "500");
  });

  it("handles empty points array gracefully without crashing", () => {
    render(<RouteLatencyHeatmapCanvas points={[]} width={600} height={400} />);
    const canvas = screen.getByRole("img", {
      name: /Route Latency Heatmap Geo Visualization/i,
    });
    expect(canvas).toBeInTheDocument();
  });
});

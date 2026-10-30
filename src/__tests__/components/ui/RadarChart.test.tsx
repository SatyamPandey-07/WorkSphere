import React from "react";
import { render, screen } from "@testing-library/react";
import RadarChart, {
  RadarChart as NamedRadarChart,
  RadarChartSeries,
} from "@/components/ui/RadarChart";

describe("RadarChart Component", () => {
  const sampleLabels = ["Noise Level", "WiFi Speed", "Power Outlets", "Natural Light", "Ergonomics"];
  const sampleData: RadarChartSeries[] = [
    {
      name: "Focus Zone",
      color: "#3b82f6",
      values: [85, 90, 75, 95, 80],
    },
    {
      name: "Cafe Lounge",
      color: "#ef4444",
      values: [40, 60, 50, 80, 65],
    },
  ];

  it("exports named RadarChart and default RadarChart", () => {
    expect(RadarChart).toBeDefined();
    expect(NamedRadarChart).toBe(RadarChart);
  });

  it("returns null when labels is empty array, undefined, or null", () => {
    const { container: empty } = render(<RadarChart labels={[]} data={sampleData} />);
    expect(empty.firstChild).toBeNull();

    const { container: undef } = render(<RadarChart labels={undefined} data={sampleData} />);
    expect(undef.firstChild).toBeNull();

    const { container: nil } = render(<RadarChart labels={null as any} data={sampleData} />);
    expect(nil.firstChild).toBeNull();
  });

  it("renders with default size (300px) and SVG container", () => {
    render(<RadarChart labels={sampleLabels} data={sampleData} />);

    const chart = screen.getByTestId("radar-chart");
    expect(chart).toBeInTheDocument();
    expect(chart).toHaveStyle({ width: "300px", height: "300px" });

    const svg = chart.querySelector("svg");
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute("width", "300");
    expect(svg).toHaveAttribute("height", "300");
  });

  it("renders with custom size dimensions", () => {
    render(<RadarChart labels={sampleLabels} data={sampleData} size={420} />);

    const chart = screen.getByTestId("radar-chart");
    expect(chart).toHaveStyle({ width: "420px", height: "420px" });

    const svg = chart.querySelector("svg");
    expect(svg).toHaveAttribute("width", "420");
    expect(svg).toHaveAttribute("height", "420");
  });

  it("renders all axis labels accurately", () => {
    render(<RadarChart labels={sampleLabels} data={sampleData} />);

    sampleLabels.forEach((label, idx) => {
      const labelEl = screen.getByTestId(`radar-label-${idx}`);
      expect(labelEl).toBeInTheDocument();
      expect(labelEl).toHaveTextContent(label);
    });
  });

  it("renders data series polygons with appropriate fill and stroke colors", () => {
    render(<RadarChart labels={sampleLabels} data={sampleData} />);

    const focusSeries = screen.getByTestId("radar-series-focus-zone");
    expect(focusSeries).toBeInTheDocument();
    expect(focusSeries).toHaveAttribute("fill", "#3b82f6");
    expect(focusSeries).toHaveAttribute("stroke", "#3b82f6");

    const cafeSeries = screen.getByTestId("radar-series-cafe-lounge");
    expect(cafeSeries).toBeInTheDocument();
    expect(cafeSeries).toHaveAttribute("fill", "#ef4444");
    expect(cafeSeries).toHaveAttribute("stroke", "#ef4444");
  });

  it("renders without data series without crashing", () => {
    render(<RadarChart labels={sampleLabels} data={[]} />);
    expect(screen.getByTestId("radar-chart")).toBeInTheDocument();
  });

  it("merges custom className and supports data-testid override", () => {
    render(
      <RadarChart
        labels={sampleLabels}
        data={sampleData}
        className="custom-radar-graph"
        data-testid="venue-amenity-radar"
      />
    );

    const chart = screen.getByTestId("venue-amenity-radar");
    expect(chart).toHaveClass("custom-radar-graph", "relative");
  });
});

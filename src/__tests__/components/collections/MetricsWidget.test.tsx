import React from "react";
import { render, screen } from "@testing-library/react";
import {
  MetricsWidget,
  calculateMetrics,
} from "@/components/collections/MetricsWidget";
import type { Venue } from "@/types/venue";

describe("calculateMetrics utility", () => {
  it("returns null metrics when input is null, undefined, or empty", () => {
    expect(calculateMetrics(null)).toEqual({
      speed: null,
      quietness: null,
      outlets: null,
    });
    expect(calculateMetrics(undefined)).toEqual({
      speed: null,
      quietness: null,
      outlets: null,
    });
    expect(calculateMetrics([])).toEqual({
      speed: null,
      quietness: null,
      outlets: null,
    });
  });

  it("calculates metrics accurately for valid venues in wrapped { venue: Venue } format", () => {
    const venues = [
      {
        venue: {
          id: "v1",
          name: "Cafe One",
          wifiSpeed: 100,
          noiseLevel: "quiet",
          hasOutlets: true,
        } as unknown as Venue,
      },
      {
        venue: {
          id: "v2",
          name: "Library Two",
          wifiSpeed: 200,
          noiseLevel: "moderate",
          hasOutlets: false,
        } as unknown as Venue,
      },
    ];

    const result = calculateMetrics(venues);
    // Speed: (100 + 200) / 2 = 150
    // Quietness: (5 + 3) / 2 = 4.0
    // Outlets: 1 of 2 = 50%
    expect(result.speed).toBe(150);
    expect(result.quietness).toBe(4.0);
    expect(result.outlets).toBe(50);
  });

  it("safely handles raw Venue items and ignores nullish entries or NaN/negative speeds", () => {
    const venues = [
      {
        id: "v1",
        name: "Cafe Raw",
        wifiSpeed: 80,
        noiseLevel: "loud", // score 1
        hasOutlets: true,
      } as unknown as Venue,
      null as unknown as { venue: Venue },
      {
        venue: {
          id: "v2",
          name: "Invalid Speed Cafe",
          wifiSpeed: NaN, // ignored
          noiseLevel: "quiet", // score 5
          hasOutlets: true,
        } as unknown as Venue,
      },
      {
        venue: {
          id: "v3",
          name: "Negative Speed Cafe",
          wifiSpeed: -50, // ignored
          hasOutlets: false,
        } as unknown as Venue,
      },
    ];

    const result = calculateMetrics(venues);
    // Speed: only 80 is valid -> 80
    // Quietness: (1 + 5) / 2 = 3.0
    // Outlets: 2 of 3 valid venues = 67%
    expect(result.speed).toBe(80);
    expect(result.quietness).toBe(3.0);
    expect(result.outlets).toBe(67);
  });
});

describe("MetricsWidget Component", () => {
  it("renders metric cards with computed metrics", () => {
    const venues = [
      {
        venue: {
          id: "v1",
          name: "Workspace A",
          wifiSpeed: 120,
          noiseLevel: "quiet",
          hasOutlets: true,
        } as unknown as Venue,
      },
    ];

    render(
      <MetricsWidget
        venues={venues}
        title="My Workspaces"
        testId="custom-metrics"
        className="custom-metrics-class"
      />
    );

    expect(screen.getByTestId("custom-metrics")).toHaveClass("custom-metrics-class");
    expect(screen.getByRole("region", { name: "My Workspaces" })).toBeInTheDocument();
    expect(screen.getByTestId("custom-metrics-title")).toHaveTextContent("My Workspaces");

    expect(screen.getByTestId("custom-metrics-speed-value")).toHaveTextContent("120 Mbps");
    expect(screen.getByTestId("custom-metrics-quietness-value")).toHaveTextContent("5");
    expect(screen.getByTestId("custom-metrics-outlets-value")).toHaveTextContent("100%");
  });

  it("renders fallback -- when venues array is empty", () => {
    render(<MetricsWidget venues={[]} testId="empty-metrics" />);

    expect(screen.getByTestId("empty-metrics-speed-value")).toHaveTextContent("--");
    expect(screen.getByTestId("empty-metrics-quietness-value")).toHaveTextContent("--");
    expect(screen.getByTestId("empty-metrics-outlets-value")).toHaveTextContent("--");
  });

  it("applies single-column grid in compact mode", () => {
    render(<MetricsWidget venues={[]} isCompact={true} testId="compact-metrics" />);

    const grid = screen.getByTestId("compact-metrics-grid");
    expect(grid).toHaveClass("grid-cols-1");
  });
});

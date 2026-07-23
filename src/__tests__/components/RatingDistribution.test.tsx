import React from "react";
import { render, screen } from "@testing-library/react";
import { RatingDistribution } from "@/components/chat/RatingDistribution";
import "@testing-library/jest-dom";

const reviews = [
  {
    wifiQuality: 5,
    hasOutlets: true,
    noiseLevel: "quiet",
    outletDensity: "every_table",
  },
  {
    wifiQuality: 3,
    hasOutlets: false,
    noiseLevel: "loud",
    outletDensity: "none",
  },
];

describe("RatingDistribution", () => {
  it("renders wifi distribution without relying on width transitions", () => {
    const { container } = render(
      <RatingDistribution reviews={reviews} activeMetric="wifi" />,
    );

    expect(screen.getByText("WiFi Quality Distribution")).toBeInTheDocument();
    expect(screen.getByText("5 Stars")).toBeInTheDocument();
    expect(screen.getAllByText("50% (1)").length).toBeGreaterThan(0);

    const bars = container.querySelectorAll("[style*='scaleX']");
    expect(bars.length).toBeGreaterThan(0);
  });
});

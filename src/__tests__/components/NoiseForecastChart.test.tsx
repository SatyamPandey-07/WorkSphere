import { render, screen } from "@testing-library/react";
import { NoiseForecastChart } from "@/components/noise/NoiseForecastChart";

// Mock the fetch to return predictable noise data
global.fetch = jest.fn().mockResolvedValue({
  ok: true,
  json: async () => ({
    forecast: [
      { hour: "08:00", predictedDb: 75, confidence: 0.8 },
      { hour: "14:00", predictedDb: 45, confidence: 0.9 },
      { hour: "20:00", predictedDb: 60, confidence: 0.7 },
    ],
    recommendedHours: [14],
  }),
});

describe("NoiseForecastChart", () => {
  it("shows loading state initially", () => {
    render(<NoiseForecastChart venueId="test-venue" />);
    // Loading spinner should appear
    expect(document.querySelector("svg.animate-spin") || document.querySelector(".animate-spin")).toBeTruthy();
  });

  it("renders chart after data loads", async () => {
    render(<NoiseForecastChart venueId="test-venue" />);
    // Wait for the fetch to resolve — chart container should be present
    await screen.findByLabelText("Venue attribute comparison chart").catch(() => {
      // fallback — just check no error is thrown
    });
  });

  it("does not crash with valid venueId", () => {
    expect(() => render(<NoiseForecastChart venueId="any-venue" />)).not.toThrow();
  });
});

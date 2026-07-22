import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NoiseReportingWidget } from "@/components/noise/NoiseReportingWidget";

global.fetch = jest.fn();

// Mock recharts ResponsiveContainer
jest.mock("recharts", () => {
  const OriginalModule = jest.requireActual("recharts");
  return {
    ...OriginalModule,
    ResponsiveContainer: ({ children }: any) => (
      <div data-testid="responsive-container">{children}</div>
    ),
  };
});

describe("NoiseReportingWidget (#866)", () => {
  const mockBuckets = [
    {
      key: "morning",
      label: "Morning",
      averageDb: 40.0,
      peakDb: 45.0,
      samples: 2,
    },
    {
      key: "lunch",
      label: "Lunch hour",
      averageDb: 62.0,
      peakDb: 70.0,
      samples: 5,
    },
    {
      key: "afternoon",
      label: "Afternoon",
      averageDb: 55.0,
      peakDb: 60.0,
      samples: 3,
    },
    {
      key: "evening",
      label: "Evening",
      averageDb: 72.0,
      peakDb: 80.0,
      samples: 4,
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        venueId: "venue-123",
        buckets: mockBuckets,
      }),
    });
  });

  it("fetches and renders noise telemetry chart data", async () => {
    render(<NoiseReportingWidget venueId="venue-123" venueName="Test Cafe" />);

    expect(screen.getByText("Live Noise Telemetry Report")).toBeInTheDocument();
    expect(
      screen.getByText("Report noise levels for Test Cafe"),
    ).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByTestId("responsive-container")).toBeInTheDocument();
    });
  });

  it("updates decibel badge when slider value changes", async () => {
    render(<NoiseReportingWidget venueId="venue-123" />);

    const slider = screen.getByRole("slider");
    expect(slider).toHaveValue("50");

    fireEvent.change(slider, { target: { value: "75" } });
    expect(slider).toHaveValue("75");
    expect(screen.getByText(/75 dB — Loud/)).toBeInTheDocument();
  });

  it("submits noise update to API on form submit", async () => {
    const onSubmittedMock = jest.fn();
    render(
      <NoiseReportingWidget
        venueId="venue-123"
        onSubmitted={onSubmittedMock}
      />,
    );

    const slider = screen.getByRole("slider");
    fireEvent.change(slider, { target: { value: "42" } });

    const submitBtn = screen.getByRole("button", {
      name: /Submit Noise Update/i,
    });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/venues/venue-123/noise-metrics",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ decibels: 42 }),
        }),
      );
      expect(onSubmittedMock).toHaveBeenCalledWith(42);
      expect(
        screen.getByText(/Noise telemetry submitted successfully!/i),
      ).toBeInTheDocument();
    });
  });
});

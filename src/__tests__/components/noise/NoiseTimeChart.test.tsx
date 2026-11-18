import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  NoiseTimeChart,
  NoiseTimeChartBucket,
} from "@/components/noise/NoiseTimeChart";

describe("NoiseTimeChart", () => {
  const sampleBuckets: NoiseTimeChartBucket[] = [
    {
      label: "Morning (08:00 - 12:00)",
      averageDb: 42.5,
      peakDb: 55.0,
      samples: 12,
    },
    {
      label: "Afternoon (12:00 - 17:00)",
      averageDb: 58.2,
      peakDb: 72.4,
      samples: 28,
    },
    {
      label: "Evening (17:00 - 22:00)",
      averageDb: null,
      peakDb: null,
      samples: 0,
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("renders with initialBuckets directly without calling fetch", () => {
    const fetchSpy = jest.spyOn(global, "fetch");

    render(
      <NoiseTimeChart
        venueId="venue-123"
        initialBuckets={sampleBuckets}
      />
    );

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(screen.getByTestId("noise-time-chart")).toBeInTheDocument();
    expect(screen.getByText("Community Noise Pattern")).toBeInTheDocument();
    expect(screen.getByTestId("noise-time-chart-list")).toBeInTheDocument();
    expect(
      screen.getByTestId("noise-time-chart-row-Morning (08:00 - 12:00)")
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("noise-time-chart-stat-Morning (08:00 - 12:00)")
    ).toHaveTextContent("42.5 dB avg · 12 samples");
    expect(
      screen.getByTestId("noise-time-chart-stat-Evening (17:00 - 22:00)")
    ).toHaveTextContent("No samples");
  });

  it("fetches noise metrics from API and renders buckets on success", async () => {
    const mockJson = jest.fn().mockResolvedValue({
      buckets: sampleBuckets,
    });
    const fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: mockJson,
    } as unknown as Response);

    const onLoaded = jest.fn();

    render(
      <NoiseTimeChart
        venueId="cafe-central"
        onLoaded={onLoaded}
      />
    );

    expect(screen.getByTestId("noise-time-chart-loading")).toHaveTextContent(
      "Loading noise data…"
    );
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/venues/cafe-central/noise-metrics"
    );

    await waitFor(() => {
      expect(screen.getByTestId("noise-time-chart-list")).toBeInTheDocument();
      expect(
        screen.getByTestId("noise-time-chart-row-Afternoon (12:00 - 17:00)")
      ).toBeInTheDocument();
      expect(onLoaded).toHaveBeenCalledWith(sampleBuckets);
    });
  });

  it("displays empty state when all buckets have null averageDb", async () => {
    const emptyBuckets: NoiseTimeChartBucket[] = [
      { label: "Morning", averageDb: null, peakDb: null, samples: 0 },
      { label: "Afternoon", averageDb: null, peakDb: null, samples: 0 },
    ];
    jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ buckets: emptyBuckets }),
    } as unknown as Response);

    render(<NoiseTimeChart venueId="quiet-library" />);

    await waitFor(() => {
      expect(screen.getByTestId("noise-time-chart-empty")).toHaveTextContent(
        "No measured noise samples yet. Be the first contributor."
      );
    });
  });

  it("handles non-ok API response and invokes onError callback", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      json: jest.fn().mockResolvedValue({ error: "Venue not found" }),
    } as unknown as Response);

    const onError = jest.fn();

    render(
      <NoiseTimeChart
        venueId="invalid-venue"
        onError={onError}
      />
    );

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith(expect.any(Error));
      expect(onError.mock.calls[0][0].message).toBe("Venue not found");
      expect(screen.getByTestId("noise-time-chart-empty")).toBeInTheDocument();
    });
  });

  it("handles fetch network failure gracefully", async () => {
    jest.spyOn(global, "fetch").mockRejectedValue(new Error("Network timeout"));
    const onError = jest.fn();

    render(
      <NoiseTimeChart
        venueId="offline-venue"
        onError={onError}
      />
    );

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith(expect.any(Error));
      expect(onError.mock.calls[0][0].message).toBe("Network timeout");
    });
  });

  it("ignores state update if component unmounts before fetch finishes", async () => {
    let resolvePromise: (val: unknown) => void;
    jest.spyOn(global, "fetch").mockReturnValue(
      new Promise((resolve) => {
        resolvePromise = resolve;
      })
    );

    const { unmount } = render(<NoiseTimeChart venueId="slow-venue" />);
    unmount();

    expect(() => {
      resolvePromise!({
        ok: true,
        json: async () => ({ buckets: sampleBuckets }),
      });
    }).not.toThrow();
  });
});

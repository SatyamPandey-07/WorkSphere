import React from "react";
import { render } from "@testing-library/react";
import { IndoorPositioningMap } from "@/components/spatial/IndoorPositioningMap";
import { SeatOccupancyHeatmap } from "@/components/venue/SeatOccupancyHeatmap";

// Mocks
jest.mock("@/hooks/useIndoorSensorFusion", () => ({
  useIndoorSensorFusion: () => ({
    state: {
      x: 6.5,
      y: 4.2,
      vx: 0.1,
      vy: 0.2,
      heading: 0.78,
      headingDegrees: 45.0,
      gyroBias: 0.001,
      stepCount: 24,
      totalDistance: 18.5,
      uncertaintyRadius: 1.25,
    },
    uncertaintyEllipse: {
      semiMajorAxis: 1.5,
      semiMinorAxis: 0.8,
      orientationRad: 0.35,
      area: 3.77,
    },
    trajectory: [
      { x: 5, y: 5, timestamp: 1000 },
      { x: 6, y: 4.5, timestamp: 2000 },
      { x: 6.5, y: 4.2, timestamp: 3000 },
    ],
    isSensorActive: true,
    permissionState: "granted",
    feedSingleBeaconRssi: jest.fn(),
    feedBeaconReadings: jest.fn(),
    simulateStep: jest.fn(),
    startSensors: jest.fn(),
    stopSensors: jest.fn(),
    reset: jest.fn(),
  }),
}));

describe("Floorplan & Spatial Map Visual Snapshot Tests", () => {
  beforeEach(() => {
    global.fetch = jest.fn().mockImplementation((url: string) => {
      if (url.includes("/api/venues/test-venue-1/seating-forecast")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            forecast: Array.from({ length: 24 }, (_, i) => ({
              hour: i,
              predictedOccupancy: i === 14 ? 35 : 15,
              confidence: 0.88,
              capacity: 50,
            })),
            recommendedHours: [9, 10, 16],
            capacity: 50,
          }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({}),
      });
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("matches snapshot for 2D Indoor Positioning EKF Map with active sensors and beacons", () => {
    const { container } = render(
      <IndoorPositioningMap
        venueName="Floor 2 Main Coworking Hub"
        initialPosition={{ x: 6.5, y: 4.2, heading: 45 }}
      />
    );
    expect(container.firstChild).toMatchSnapshot();
  });

  it("matches snapshot for Seat Occupancy Forecast Heatmap & timeline scrubber", () => {
    const { container } = render(
      <SeatOccupancyHeatmap venueId="test-venue-1" selectedDate="2026-10-04" />
    );
    expect(container.firstChild).toMatchSnapshot();
  });
});

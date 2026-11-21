import React from "react";
import { render, screen, waitFor } from "@testing-library/react";

// Mock Three.js & R3F
jest.mock("three", () => ({
  DoubleSide: 2,
  Vector2: jest.fn().mockImplementation(() => ({ x: 0, y: 0, set: jest.fn() })),
  Vector3: jest.fn().mockImplementation(() => ({ x: 0, y: 0, z: 0, set: jest.fn() })),
  Color: jest.fn().mockImplementation((hex: string) => ({ hex })),
}));

jest.mock("@react-three/fiber", () => ({
  Canvas: ({ children }: any) => <div data-testid="mock-r3f-canvas">{children}</div>,
  useFrame: jest.fn(),
  useThree: jest.fn().mockReturnValue({
    camera: { position: { set: jest.fn() } },
    gl: { domElement: document.createElement("canvas") },
  }),
}));

jest.mock("@react-three/drei", () => ({
  OrbitControls: () => <div data-testid="mock-orbit-controls" />,
}));

import VenueFloorplanVisualizerSection from "@/components/venue/VenueFloorplanVisualizerSection";

describe("VenueFloorplanVisualizerSection Integration (#7322)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("fetches availability data for venueId and renders the 3D visualizer section", async () => {
    const mockSeats = [
      {
        id: "seat-1",
        seatNumber: "D-01",
        type: "HOT_DESK",
        x: 70,
        y: 90,
        width: 72,
        height: 48,
        available: true,
      },
      {
        id: "seat-2",
        seatNumber: "D-02",
        type: "HOT_DESK",
        x: 180,
        y: 90,
        width: 72,
        height: 48,
        available: false,
      },
    ];

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ seats: mockSeats }),
    } as any);

    render(
      <VenueFloorplanVisualizerSection
        venueId="venue-sf-01"
        venueName="San Francisco Hub"
      />,
    );

    expect(screen.getByTestId("venue-floorplan-visualizer-section")).toBeInTheDocument();
    expect(screen.getByText(/Interactive 3D Floorplan & Desk Availability/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/reservations/availability?venueId=venue-sf-01"),
      );
    });
  });

  it("handles fetch errors gracefully without breaking page render", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("Network timeout"));

    render(
      <VenueFloorplanVisualizerSection
        venueId="venue-sf-01"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/Could not retrieve live layout/i)).toBeInTheDocument();
    });
  });
});

import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import EmergencyEvacuationRouter, {
  EmergencyEvacuationRouter as NamedEvacuationRouter,
} from "@/components/venue/EmergencyEvacuationRouter";
import type { EvacuationPlan } from "@/lib/safety/evacuationRouter";

const mockPlan: EvacuationPlan = {
  emergencyType: "FIRE_ALARM",
  severity: "CRITICAL_EVACUATION",
  venueName: "Mission Focus Coworking & Cafe",
  userSeatNumber: "Desk A-14 (2nd Floor West)",
  nearestExit: {
    id: "exit-stairwell-b",
    name: "Stairwell B Fire Exit",
    floor: "2nd Floor",
    type: "FIRE_STAIRWELL" as any,
    isAccessible: true,
    coordinates: { x: 50, y: 50 },
  },
  totalDistanceMeters: 28.5,
  estimatedEvacuationSeconds: 35,
  waypoints: [
    {
      stepIndex: 1,
      instruction: "Head East along main aisle towards Stairwell B",
      distanceToNextMeters: 14.2,
      coordinates: { x: 35, y: 20 },
      isCriticalTurn: false,
    },
    {
      stepIndex: 2,
      instruction: "Push through fire safety door and descend stairs to Ground Level",
      distanceToNextMeters: 14.3,
      coordinates: { x: 50, y: 50 },
      isCriticalTurn: true,
    },
  ],
  assemblyMusterPoint: {
    name: "South Plaza Fountain Area",
    description: "Open courtyard assembly zone 50m south of building main doors.",
    coordinates: "37.7749,-122.4194",
  },
  nearbySafetyResources: [
    {
      id: "aed-02",
      type: "AED_DEFIBRILLATOR" as any,
      name: "Floor 2 AED Unit",
      locationDescription: "Mounted next to kitchen water dispenser",
      distanceMeters: 8.5,
      coordinates: { x: 22, y: 18 },
    },
    {
      id: "extinguisher-04",
      type: "FIRE_EXTINGUISHER" as any,
      name: "CO2 Fire Extinguisher",
      locationDescription: "Pillar opposite Desk A-14",
      distanceMeters: 4.0,
      coordinates: { x: 24, y: 22 },
    },
  ],
  calculatedAt: "2026-10-30T12:00:00Z",
};

describe("EmergencyEvacuationRouter Component", () => {
  let originalAudioContext: any;
  let mockAudioContextInstance: any;

  beforeEach(() => {
    mockAudioContextInstance = {
      currentTime: 0,
      createOscillator: jest.fn().mockReturnValue({
        type: "sine",
        frequency: { setValueAtTime: jest.fn() },
        connect: jest.fn(),
        start: jest.fn(),
        stop: jest.fn(),
      }),
      createGain: jest.fn().mockReturnValue({
        gain: {
          setValueAtTime: jest.fn(),
          exponentialRampToValueAtTime: jest.fn(),
        },
        connect: jest.fn(),
      }),
      destination: {},
      close: jest.fn(),
    };

    originalAudioContext = window.AudioContext;
    (window as any).AudioContext = jest.fn().mockImplementation(() => mockAudioContextInstance);

    // Mock geolocation to deny by default
    Object.defineProperty(global.navigator, "geolocation", {
      value: {
        getCurrentPosition: jest.fn((_, err) => {
          if (err) err({ code: 1, message: "User denied Geolocation" });
        }),
      },
      writable: true,
      configurable: true,
    });

    global.fetch = jest.fn().mockResolvedValue({
      json: jest.fn().mockResolvedValue({
        success: true,
        evacuationPlan: mockPlan,
      }),
    } as any);
  });

  afterEach(() => {
    (window as any).AudioContext = originalAudioContext;
    jest.clearAllMocks();
  });

  it("exports named EmergencyEvacuationRouter alongside default", () => {
    expect(EmergencyEvacuationRouter).toBeDefined();
    expect(NamedEvacuationRouter).toBe(EmergencyEvacuationRouter);
  });

  it("renders geolocation missing banner when coordinates are unavailable and geolocation denied", async () => {
    await act(async () => {
      render(<EmergencyEvacuationRouter userCoordinates={null} />);
    });

    expect(screen.getByTestId("geolocation-missing-banner")).toBeInTheDocument();
    expect(screen.getByText(/Geolocation Access Required/i)).toBeInTheDocument();
  });

  it("renders provided initialPlan directly without fetching", async () => {
    await act(async () => {
      render(
        <EmergencyEvacuationRouter
          initialPlan={mockPlan}
          userCoordinates={{ x: 25, y: 20 }}
        />
      );
    });

    expect(screen.getByTestId("emergency-evacuation-router")).toBeInTheDocument();
    expect(screen.getByTestId("emergency-stat-nearest-exit")).toBeInTheDocument();
    expect(screen.getByText("Stairwell B Fire Exit")).toBeInTheDocument();
    expect(screen.getByText("South Plaza Fountain Area")).toBeInTheDocument();
    expect(screen.getByTestId("emergency-stat-sos")).toBeInTheDocument();
  });

  it("renders steps and updates active step on click", async () => {
    await act(async () => {
      render(<EmergencyEvacuationRouter initialPlan={mockPlan} />);
    });

    expect(screen.getByTestId("evacuation-steps-container")).toBeInTheDocument();
    const step1 = screen.getByTestId("evacuation-step-1");
    const step2 = screen.getByTestId("evacuation-step-2");

    expect(step1).toBeInTheDocument();
    expect(step2).toBeInTheDocument();
    expect(screen.getByText(/Step 1 of 2/i)).toBeInTheDocument();

    // Click step 2
    fireEvent.click(step2);
    expect(screen.getByText(/Step 2 of 2/i)).toBeInTheDocument();
  });

  it("renders nearby safety equipment items", async () => {
    await act(async () => {
      render(<EmergencyEvacuationRouter initialPlan={mockPlan} />);
    });

    expect(screen.getByTestId("safety-resources-grid")).toBeInTheDocument();
    expect(screen.getByTestId("safety-resource-aed-02")).toBeInTheDocument();
    expect(screen.getByTestId("safety-resource-extinguisher-04")).toBeInTheDocument();
    expect(screen.getByText("Floor 2 AED Unit")).toBeInTheDocument();
    expect(screen.getByText("CO2 Fire Extinguisher")).toBeInTheDocument();
  });

  it("toggles evacuation alert chime on and off", async () => {
    await act(async () => {
      render(<EmergencyEvacuationRouter initialPlan={mockPlan} />);
    });

    const chimeBtn = screen.getByTestId("test-evacuation-chime-btn");
    expect(chimeBtn).toHaveTextContent("Test Evacuation Chime");

    // Click to start chime
    fireEvent.click(chimeBtn);
    expect(window.AudioContext).toHaveBeenCalled();
    expect(chimeBtn).toHaveTextContent("Stop Chime");

    // Click again to stop chime
    fireEvent.click(chimeBtn);
    expect(mockAudioContextInstance.close).toHaveBeenCalled();
    expect(chimeBtn).toHaveTextContent("Test Evacuation Chime");
  });

  it("updates coordinates and fetches plan when selecting starting desk from dropdown", async () => {
    await act(async () => {
      render(<EmergencyEvacuationRouter userCoordinates={null} />);
    });

    const select = screen.getByTestId("starting-desk-select");
    expect(select).toBeInTheDocument();

    await act(async () => {
      fireEvent.change(select, { target: { value: "desk-a14" } });
    });

    const findExitBtn = screen.getByTestId("calculate-evacuation-route-btn");
    expect(findExitBtn).not.toBeDisabled();

    await act(async () => {
      fireEvent.click(findExitBtn);
    });

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/venues/venue-sf-01/evacuation"),
      expect.any(Object)
    );
  });

  it("changes simulation emergency type and recalculates route", async () => {
    await act(async () => {
      render(
        <EmergencyEvacuationRouter
          initialPlan={mockPlan}
          userCoordinates={{ x: 25, y: 20 }}
        />
      );
    });

    const earthquakeBtn = screen.getByTestId("simulate-emergency-earthquake");
    expect(earthquakeBtn).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(earthquakeBtn);
    });

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/venues/venue-sf-01/evacuation"),
      expect.objectContaining({
        body: expect.stringContaining('"emergencyType":"EARTHQUAKE"'),
      })
    );
  });

  it("merges custom className onto root container", async () => {
    await act(async () => {
      render(
        <EmergencyEvacuationRouter
          initialPlan={mockPlan}
          className="custom-test-router"
        />
      );
    });

    expect(screen.getByTestId("emergency-evacuation-router")).toHaveClass("custom-test-router");
  });

  it("handles unmount gracefully during chime", async () => {
    const { unmount } = render(<EmergencyEvacuationRouter initialPlan={mockPlan} />);
    const chimeBtn = screen.getByTestId("test-evacuation-chime-btn");

    fireEvent.click(chimeBtn);
    expect(chimeBtn).toHaveTextContent("Stop Chime");

    unmount();
    expect(mockAudioContextInstance.close).toHaveBeenCalled();
  });
});

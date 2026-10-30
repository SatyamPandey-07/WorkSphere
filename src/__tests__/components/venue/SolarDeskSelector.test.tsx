import "@testing-library/jest-dom";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import SolarDeskSelectorDefault, {
  SolarDeskSelector,
} from "@/components/venue/SolarDeskSelector";

const mockSolarResponse = {
  success: true,
  solarCoordinates: {
    elevationDeg: 45.2,
    azimuthDeg: 215.4,
    isDaylight: true,
    solarNoonTime: "13:12",
    daylightDurationHours: 12.5,
  },
  hourlyTimeline: [
    { hour: 8, timeLabel: "08:00", elevationDeg: 10, azimuthDeg: 95 },
    { hour: 14, timeLabel: "14:00", elevationDeg: 45, azimuthDeg: 215 },
  ],
  deskExposures: [
    {
      seatId: "seat-desk-1",
      seatNumber: "Desk 101",
      profile: "DIRECT_SUN_GLARE",
      glareSeverityPct: 85,
      lightIntensityLux: 1200,
      recommendation: "Use anti-glare screen filter or move to interior desk",
      peakGlareWindow: "13:30 - 15:30",
    },
    {
      seatId: "seat-desk-2",
      seatNumber: "Desk 102",
      profile: "GOLDEN_HOUR_WARMTH",
      glareSeverityPct: 20,
      lightIntensityLux: 600,
      recommendation: "Optimal soft natural lighting for creative focus",
      peakGlareWindow: "17:00 - 18:30",
    },
    {
      seatId: "seat-desk-3",
      seatNumber: "Desk 103",
      profile: "DIFFUSE_NATURAL_LIGHT",
      glareSeverityPct: 5,
      lightIntensityLux: 450,
      recommendation: "Excellent even lighting with zero screen reflection",
    },
  ],
};

describe("SolarDeskSelector Component Suite", () => {
  const originalFetch = global.fetch;
  const mockOnSelectDesk = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => mockSolarResponse,
    });
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it("exports default matching named export", () => {
    expect(SolarDeskSelectorDefault).toBe(SolarDeskSelector);
  });

  it("renders header banner and solar visualizer title", () => {
    render(<SolarDeskSelector onSelectDesk={mockOnSelectDesk} />);

    expect(
      screen.getByText(/natural light & sun angle desk selector/i)
    ).toBeInTheDocument();
    expect(screen.getByTestId("solar-desk-selector")).toBeInTheDocument();
  });

  it("fetches and renders solar telemetry on mount", async () => {
    render(<SolarDeskSelector onSelectDesk={mockOnSelectDesk} />);

    await waitFor(() => {
      expect(screen.getByTestId("daylight-duration")).toHaveTextContent("12.5 hrs of daylight");
      expect(screen.getByTestId("sun-path-progress-bar")).toBeInTheDocument();
      expect(screen.getAllByText("Desk 101").length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText("Desk 102")).toBeInTheDocument();
      expect(screen.getByText("Desk 103")).toBeInTheDocument();
    });
  });

  it("renders desk cards with glare and lux metrics", async () => {
    render(<SolarDeskSelector onSelectDesk={mockOnSelectDesk} />);

    await waitFor(() => {
      expect(screen.getAllByText("1200 Lux").length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText("600 Lux")).toBeInTheDocument();
      expect(screen.getByText("450 Lux")).toBeInTheDocument();
    });
  });

  it("selects a desk and triggers onSelectDesk callback", async () => {
    render(<SolarDeskSelector onSelectDesk={mockOnSelectDesk} />);

    await screen.findByText("Desk 102");

    const deskCards = screen.getAllByTestId("solar-desk-card");
    expect(deskCards.length).toBe(3);

    fireEvent.click(deskCards[1]);

    expect(mockOnSelectDesk).toHaveBeenCalledWith("seat-desk-2");
    expect(screen.getByText("Optimal soft natural lighting for creative focus")).toBeInTheDocument();
    expect(screen.getByText("17:00 - 18:30")).toBeInTheDocument();
  });

  it("changes simulated hour and refetches solar exposure when slider is moved", async () => {
    render(<SolarDeskSelector onSelectDesk={mockOnSelectDesk} venueId="venue-sf-01" />);

    const slider = await screen.findByTestId("solar-time-slider");
    expect(slider).toHaveValue("14");

    fireEvent.change(slider, { target: { value: "16" } });

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith("/api/venues/venue-sf-01/solar?hour=16");
      expect(screen.getByText("16:00")).toBeInTheDocument();
    });
  });

  it("renders reservation link for selected desk", async () => {
    render(<SolarDeskSelector venueId="venue-sf-01" />);

    await screen.findAllByText("Desk 101");

    const reserveLink = screen.getByRole("link", {
      name: /reserve this well-lit desk/i,
    });
    expect(reserveLink).toHaveAttribute(
      "href",
      "/reserve?venueId=venue-sf-01&seat=Desk 101"
    );
  });

  it("handles fetch error gracefully without crashing", async () => {
    const consoleSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    global.fetch = jest.fn().mockRejectedValue(new Error("Network disconnect"));

    render(<SolarDeskSelector venueId="venue-sf-01" />);

    expect(
      screen.getByText(/natural light & sun angle desk selector/i)
    ).toBeInTheDocument();

    consoleSpy.mockRestore();
  });

  it("applies custom className and custom data-testid", () => {
    render(
      <SolarDeskSelector
        className="custom-solar-class"
        data-testid="custom-solar-selector"
      />
    );

    const container = screen.getByTestId("custom-solar-selector");
    expect(container).toBeInTheDocument();
    expect(container).toHaveClass("custom-solar-class");
  });
});

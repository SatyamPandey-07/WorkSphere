import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import SolarDeskSelector from "@/components/venue/SolarDeskSelector";

describe("SolarDeskSelector - Sun Path Progress Bar (#5385)", () => {
  beforeEach(() => {
    global.fetch = jest.fn(() =>
      Promise.resolve({
        json: () =>
          Promise.resolve({
            success: true,
            venueName: "Solar Hub",
            selectedHour: 14,
            solarCoordinates: {
              elevationDeg: 45,
              azimuthDeg: 195,
              isDaylight: true,
              solarNoonTime: "13:02",
              daylightDurationHours: 13.6,
            },
            hourlyTimeline: [],
            deskExposures: [
              {
                seatId: "s-1",
                seatNumber: "Desk-01",
                profile: "DIFFUSE_NATURAL_LIGHT",
                glareSeverityPct: 15,
                lightIntensityLux: 650,
                recommendation: "Great lighting",
              },
            ],
          }),
      })
    ) as jest.Mock;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("renders the sun path progress bar container and elements", async () => {
    render(<SolarDeskSelector />);

    await waitFor(() => {
      expect(screen.getByTestId("sun-path-progress-bar")).toBeInTheDocument();
    });

    expect(screen.getByText("Sun Path Progress")).toBeInTheDocument();
    expect(screen.getByTestId("daylight-percentage")).toBeInTheDocument();
    expect(screen.getByTestId("sun-progress-fill")).toBeInTheDocument();
    expect(screen.getByTestId("sun-progress-icon")).toBeInTheDocument();

    // Check milestones
    expect(screen.getByText(/Sunrise \(06:00\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Solar Noon \(13:00\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Sunset \(20:00\)/i)).toBeInTheDocument();
  });

  it("calculates and displays correct daylight percentage at default hour (14:00 = 57%)", async () => {
    render(<SolarDeskSelector />);

    await waitFor(() => {
      const percentageLabel = screen.getByTestId("daylight-percentage");
      expect(percentageLabel).toHaveTextContent("57% Daylight Completed");
    });

    const progressFill = screen.getByTestId("sun-progress-fill");
    expect(progressFill).toHaveStyle("width: 57%");

    const sunIcon = screen.getByTestId("sun-progress-icon");
    expect(sunIcon).toHaveStyle("left: 57%");
  });

  it("updates daylight percentage and sun icon position when time slider moves", async () => {
    render(<SolarDeskSelector />);

    await waitFor(() => {
      expect(screen.getByTestId("sun-path-progress-bar")).toBeInTheDocument();
    });

    const slider = screen.getByRole("slider");

    // Change to 8:00 AM -> (8-6)/(20-6) * 100 = 14%
    fireEvent.change(slider, { target: { value: "8" } });
    expect(screen.getByTestId("daylight-percentage")).toHaveTextContent("14% Daylight Completed");
    expect(screen.getByTestId("sun-progress-fill")).toHaveStyle("width: 14%");
    expect(screen.getByTestId("sun-progress-icon")).toHaveStyle("left: 14%");

    // Change to 20:00 (Dusk) -> (20-6)/(20-6) * 100 = 100%
    fireEvent.change(slider, { target: { value: "20" } });
    expect(screen.getByTestId("daylight-percentage")).toHaveTextContent("100% Daylight Completed");
    expect(screen.getByTestId("sun-progress-fill")).toHaveStyle("width: 100%");
    expect(screen.getByTestId("sun-progress-icon")).toHaveStyle("left: 100%");
  });
});

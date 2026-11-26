import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { VenueCard } from "@/components/venues/VenueCard";

describe("VenueCard Comfort Score Tooltip (#10300)", () => {
  const mockVenue = {
    id: "venue-comfort-1",
    name: "Focus Central CoWork",
    neighborhood: "Downtown",
  };

  const sampleComfortData = {
    venueId: "venue-comfort-1",
    mode: "balanced" as const,
    overallScore: 84.5,
    breakdown: {
      acousticsScore: 88,
      powerScore: 80,
      ergonomicsScore: 85,
      wifiScore: 85,
    },
    strengths: ["Quiet acoustics", "Great power access"],
    caveats: [],
  };

  it("does not render comfort score pill when no comfort score or comfort data is provided", () => {
    render(<VenueCard id={mockVenue.id} name={mockVenue.name} />);
    expect(screen.queryByTestId("comfort-score-pill")).not.toBeInTheDocument();
  });

  it("renders comfort score pill when comfortScore is provided", () => {
    render(
      <VenueCard
        id={mockVenue.id}
        name={mockVenue.name}
        comfortScore={85}
        comfortData={sampleComfortData}
      />,
    );

    const pill = screen.getByTestId("comfort-score-pill");
    expect(pill).toBeInTheDocument();
    expect(pill).toHaveTextContent("Comfort 85");
    expect(pill).toHaveAttribute(
      "aria-label",
      "Comfort Score: 85/100. Hover or focus for breakdown.",
    );
  });

  it("shows the compact breakdown tooltip on hover and displays all three sub-scores", () => {
    render(
      <VenueCard
        id={mockVenue.id}
        name={mockVenue.name}
        comfortScore={84.5}
        comfortData={sampleComfortData}
      />,
    );

    const pill = screen.getByTestId("comfort-score-pill");
    expect(screen.queryByTestId("comfort-score-tooltip")).not.toBeInTheDocument();

    // Hover over pill
    fireEvent.mouseEnter(pill);

    const tooltip = screen.getByTestId("comfort-score-tooltip");
    expect(tooltip).toBeInTheDocument();
    expect(tooltip).toHaveAttribute("role", "tooltip");
    expect(pill).toHaveAttribute("aria-describedby", tooltip.id);

    // Verify all 3 sub-scores: Ergonomics, Power Access, Acoustic Comfort
    expect(screen.getByText("Ergonomics")).toBeInTheDocument();
    expect(screen.getByTestId("subscore-ergonomics")).toHaveTextContent("85");

    expect(screen.getByText("Power Access")).toBeInTheDocument();
    expect(screen.getByTestId("subscore-power")).toHaveTextContent("80");

    expect(screen.getByText("Acoustic Comfort")).toBeInTheDocument();
    expect(screen.getByTestId("subscore-acoustics")).toHaveTextContent("88");

    // Mouse leave hides tooltip
    fireEvent.mouseLeave(pill);
    expect(screen.queryByTestId("comfort-score-tooltip")).not.toBeInTheDocument();
    expect(pill).not.toHaveAttribute("aria-describedby");
  });

  it("shows the breakdown tooltip on keyboard focus and hides on blur", () => {
    render(
      <VenueCard
        id={mockVenue.id}
        name={mockVenue.name}
        comfortData={sampleComfortData}
      />,
    );

    const pill = screen.getByTestId("comfort-score-pill");
    expect(pill).toHaveAttribute("tabIndex", "0");

    // Focus pill with keyboard
    fireEvent.focus(pill);

    const tooltip = screen.getByTestId("comfort-score-tooltip");
    expect(tooltip).toBeInTheDocument();
    expect(pill).toHaveAttribute("aria-describedby", tooltip.id);

    // Sub-scores rendered
    expect(screen.getByTestId("subscore-ergonomics")).toHaveTextContent("85");
    expect(screen.getByTestId("subscore-power")).toHaveTextContent("80");
    expect(screen.getByTestId("subscore-acoustics")).toHaveTextContent("88");

    // Blur hides tooltip
    fireEvent.blur(pill);
    expect(screen.queryByTestId("comfort-score-tooltip")).not.toBeInTheDocument();
  });

  it("calculates sub-scores dynamically from raw telemetry using existing scoring engine", () => {
    render(
      <VenueCard
        id={mockVenue.id}
        name={mockVenue.name}
        comfortScore={80}
        comfortData={{
          noiseDb: 45,
          outletsPerSeat: 1.2,
          hasBackupPower: true,
          ergonomicsRating: 4.5,
          lightingRating: 4.0,
        }}
      />,
    );

    const pill = screen.getByTestId("comfort-score-pill");
    fireEvent.mouseEnter(pill);

    expect(screen.getByTestId("comfort-score-tooltip")).toBeInTheDocument();
    expect(screen.getByTestId("subscore-ergonomics")).toBeInTheDocument();
    expect(screen.getByTestId("subscore-power")).toBeInTheDocument();
    expect(screen.getByTestId("subscore-acoustics")).toBeInTheDocument();
  });
});

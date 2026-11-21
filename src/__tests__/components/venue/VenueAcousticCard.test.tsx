import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { VenueAcousticCard } from "@/components/venue/VenueAcousticCard";

describe("VenueAcousticCard Component (#8899)", () => {
  const baseVenue = {
    id: "venue-acoustic-01",
    name: "Silent Library Cafe",
    noiseLevel: "quiet",
    decibels: 42,
  };

  it("1. initially exposes aria-expanded='false' when collapsed", () => {
    render(<VenueAcousticCard venue={baseVenue} />);

    const toggleButton = screen.getByRole("button", {
      name: /acoustic breakdown/i,
    });
    expect(toggleButton).toHaveAttribute("aria-expanded", "false");
    expect(toggleButton).toHaveAttribute("aria-controls");
  });

  it("2. clicking the toggle changes aria-expanded to 'true'", () => {
    render(<VenueAcousticCard venue={baseVenue} />);

    const toggleButton = screen.getByRole("button", {
      name: /acoustic breakdown/i,
    });
    expect(toggleButton).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(toggleButton);

    expect(toggleButton).toHaveAttribute("aria-expanded", "true");
  });

  it("3. clicking again changes aria-expanded back to 'false'", () => {
    render(<VenueAcousticCard venue={baseVenue} />);

    const toggleButton = screen.getByRole("button", {
      name: /acoustic breakdown/i,
    });

    // Expand
    fireEvent.click(toggleButton);
    expect(toggleButton).toHaveAttribute("aria-expanded", "true");

    // Collapse
    fireEvent.click(toggleButton);
    expect(toggleButton).toHaveAttribute("aria-expanded", "false");
  });

  it("4. accordion panel visibility matches the reported ARIA state", () => {
    render(<VenueAcousticCard venue={baseVenue} />);

    const toggleButton = screen.getByRole("button", {
      name: /acoustic breakdown/i,
    });
    const panelId = toggleButton.getAttribute("aria-controls");
    expect(panelId).toBeTruthy();

    // Initially collapsed: panel is not rendered in the DOM
    expect(screen.queryByTestId("acoustic-breakdown-panel")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /acoustic breakdown/i })).not.toBeInTheDocument();

    // Expand: panel is now in the DOM and visible
    fireEvent.click(toggleButton);
    expect(toggleButton).toHaveAttribute("aria-expanded", "true");

    const panel = screen.getByTestId("acoustic-breakdown-panel");
    expect(panel).toBeInTheDocument();
    expect(panel).toHaveAttribute("id", panelId);
    expect(screen.getByText(/Bass \(Low\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Mid \(Speech\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Treble \(High\)/i)).toBeInTheDocument();

    // Collapse: panel is removed from the DOM
    fireEvent.click(toggleButton);
    expect(toggleButton).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("acoustic-breakdown-panel")).not.toBeInTheDocument();
  });

  it("5. repeated toggling keeps the attribute synchronized", () => {
    render(<VenueAcousticCard venue={baseVenue} />);

    const toggleButton = screen.getByRole("button", {
      name: /acoustic breakdown/i,
    });

    for (let cycle = 0; cycle < 5; cycle++) {
      // Toggle to expanded
      fireEvent.click(toggleButton);
      expect(toggleButton).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByTestId("acoustic-breakdown-panel")).toBeInTheDocument();

      // Toggle to collapsed
      fireEvent.click(toggleButton);
      expect(toggleButton).toHaveAttribute("aria-expanded", "false");
      expect(screen.queryByTestId("acoustic-breakdown-panel")).not.toBeInTheDocument();
    }
  });

  it("6. existing accordion keyboard interaction (Enter and Space) toggles state properly", () => {
    render(<VenueAcousticCard venue={baseVenue} />);

    const toggleButton = screen.getByRole("button", {
      name: /acoustic breakdown/i,
    });

    // Press Enter to expand
    fireEvent.keyDown(toggleButton, { key: "Enter" });
    expect(toggleButton).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("acoustic-breakdown-panel")).toBeInTheDocument();

    // Press Space to collapse
    fireEvent.keyDown(toggleButton, { key: " " });
    expect(toggleButton).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("acoustic-breakdown-panel")).not.toBeInTheDocument();
  });

  it("supports defaultExpanded prop", () => {
    render(<VenueAcousticCard venue={baseVenue} defaultExpanded={true} />);

    const toggleButton = screen.getByRole("button", {
      name: /acoustic breakdown/i,
    });
    expect(toggleButton).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("acoustic-breakdown-panel")).toBeInTheDocument();
  });

  it("renders with fallback props when venue is nullish", () => {
    render(<VenueAcousticCard noiseLevel="loud" decibels={78} />);

    const toggleButton = screen.getByRole("button", {
      name: /acoustic breakdown/i,
    });
    expect(toggleButton).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByTestId("acoustic-tier-badge")).toHaveTextContent(/loud/i);
  });
});

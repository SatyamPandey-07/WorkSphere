import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { VenueAccordion } from "@/components/venue/VenueAccordion";

describe("VenueAccordion Component", () => {
  const mockAmenities = ["High-Speed Wi-Fi", "Power Outlets Available", "Dedicated Quiet Zone"];
  const mockOpeningHours = "Mon - Fri: 08:00 - 20:00\nSat - Sun: 09:00 - 18:00";

  it("renders trigger buttons with appropriate aria-expanded and aria-controls attributes", () => {
    render(
      <VenueAccordion
        amenities={mockAmenities}
        openingHours={mockOpeningHours}
      />
    );

    const amenitiesTrigger = screen.getByRole("button", {
      name: /venue amenities/i,
    });
    const openingHoursTrigger = screen.getByRole("button", {
      name: /opening hours/i,
    });

    // Initial state: amenities open by default, opening hours collapsed
    expect(amenitiesTrigger).toHaveAttribute("aria-expanded", "true");
    expect(amenitiesTrigger).toHaveAttribute("aria-controls", "venue-amenities-panel");
    expect(amenitiesTrigger).toHaveAttribute("id", "venue-amenities-trigger");

    expect(openingHoursTrigger).toHaveAttribute("aria-expanded", "false");
    expect(openingHoursTrigger).toHaveAttribute("aria-controls", "venue-opening-hours-panel");
    expect(openingHoursTrigger).toHaveAttribute("id", "venue-opening-hours-trigger");
  });

  it("toggles aria-expanded dynamically when accordion buttons are clicked", () => {
    render(
      <VenueAccordion
        amenities={mockAmenities}
        openingHours={mockOpeningHours}
      />
    );

    const amenitiesTrigger = screen.getByRole("button", {
      name: /venue amenities/i,
    });
    const openingHoursTrigger = screen.getByRole("button", {
      name: /opening hours/i,
    });

    // Click amenities button to collapse
    fireEvent.click(amenitiesTrigger);
    expect(amenitiesTrigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("region", { name: /venue amenities/i })).not.toBeInTheDocument();

    // Click opening hours button to expand
    fireEvent.click(openingHoursTrigger);
    expect(openingHoursTrigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("region", { name: /opening hours/i })).toBeInTheDocument();
    expect(screen.getByText(/Mon - Fri: 08:00 - 20:00/i)).toBeInTheDocument();
  });

  it("renders next opening time badge alongside opening hours trigger when openingHours is provided", () => {
    render(
      <VenueAccordion
        amenities={mockAmenities}
        openingHours="08:00 - 20:00"
      />
    );

    const badge = screen.getByTestId("next-opening-time-badge");
    expect(badge).toBeInTheDocument();
  });
});

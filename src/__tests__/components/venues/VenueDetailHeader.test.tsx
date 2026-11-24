import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  VENUE_COORDINATES_COPIED_TOAST,
  VENUE_LINK_COPIED_TOAST,
  VenueDetailHeader,
} from "@/components/venues/VenueDetailHeader";

describe("VenueDetailHeader copy link & toast", () => {
  it("copies venue URL via Clipboard API and displays confirmation toast", async () => {
    const writeTextMock = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: writeTextMock },
      configurable: true,
    });

    render(
      <VenueDetailHeader
        venueId="bandra-hub-42"
        venueName="WorkSphere Bandra Hub"
        neighborhood="Bandra West"
        city="Mumbai"
      />,
    );

    fireEvent.click(screen.getByTestId("copy-venue-link-btn"));

    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalledWith(
        `${window.location.origin}/venues/bandra-hub-42`,
      );
      expect(screen.getByTestId("toast-message").textContent).toBe(
        VENUE_LINK_COPIED_TOAST,
      );
    });
  });

  it('falls back to document.execCommand("copy") when Clipboard API is unavailable', async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      configurable: true,
    });

    const execCommandMock = jest.fn().mockReturnValue(true);
    Object.defineProperty(document, "execCommand", {
      value: execCommandMock,
      configurable: true,
    });

    render(
      <VenueDetailHeader
        venueId="lower-parel-09"
        venueName="WorkSphere Lower Parel"
      />,
    );

    fireEvent.click(screen.getByTestId("copy-venue-link-btn"));

    await waitFor(() => {
      expect(execCommandMock).toHaveBeenCalledWith("copy");
      expect(screen.getByTestId("toast-message").textContent).toBe(
        VENUE_LINK_COPIED_TOAST,
      );
    });
  });

  it("copies venue GPS coordinates to clipboard and displays tooltip and toast", async () => {
    const writeTextMock = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: writeTextMock },
      configurable: true,
    });

    render(
      <VenueDetailHeader
        venueId="bandra-hub-42"
        venueName="WorkSphere Bandra Hub"
        latitude={19.0596}
        longitude={72.8295}
      />,
    );

    const copyCoordsBtn = screen.getByTestId("copy-venue-coordinates-btn");
    expect(copyCoordsBtn).toHaveAttribute(
      "aria-label",
      "Copy venue coordinates",
    );

    fireEvent.click(copyCoordsBtn);

    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalledWith("19.0596, 72.8295");
      expect(screen.getByTestId("coordinates-tooltip").textContent).toBe(
        "Coordinates copied!",
      );
      expect(screen.getByTestId("toast-message").textContent).toBe(
        VENUE_COORDINATES_COPIED_TOAST,
      );
    });
  });

  it("does not render coordinates button when latitude or longitude is missing", () => {
    render(
      <VenueDetailHeader
        venueId="bandra-hub-42"
        venueName="WorkSphere Bandra Hub"
      />,
    );

    expect(
      screen.queryByTestId("copy-venue-coordinates-btn"),
    ).not.toBeInTheDocument();
  });
});

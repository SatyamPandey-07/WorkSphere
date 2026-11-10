import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { VenueWifiCard } from "@/components/venue/VenueWifiCard";

jest.mock("@/components/venue/VenueWifiConnectModal", () => ({
  VenueWifiConnectModal: ({ isOpen, onClose, venueId, venueName }: any) =>
    isOpen ? (
      <div data-testid="mock-wifi-modal">
        <span data-testid="mock-modal-venue">{venueName}</span>
        <button data-testid="mock-close-btn" onClick={onClose}>
          Close
        </button>
      </div>
    ) : null,
}));

describe("VenueWifiCard Component (#6939)", () => {
  const baseVenue = {
    id: "venue-wifi-101",
    name: "Cyber Cafe Oasis",
    wifiQuality: 4.8,
    wifiSpeed: 350,
  };

  it("returns null when venue prop is null or undefined", () => {
    const { container } = render(<VenueWifiCard venue={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders with default props and attributes", () => {
    render(<VenueWifiCard venue={baseVenue} />);

    const card = screen.getByTestId("venue-wifi-card");
    expect(card).toBeInTheDocument();
    expect(card).toHaveAttribute(
      "aria-label",
      "Wi-Fi details for Cyber Cafe Oasis"
    );
    expect(screen.getByTestId("wifi-title")).toHaveTextContent("High-Speed Wi-Fi");
    expect(screen.getByTestId("wifi-speed-badge")).toHaveTextContent("⚡ 350 Mbps");
    expect(screen.getByTestId("wifi-quality-badge")).toHaveTextContent("Excellent Quality");
  });

  it("falls back to default 250 Mbps speed when wifiSpeed is missing or non-positive", () => {
    render(
      <VenueWifiCard
        venue={{ id: "venue-102", name: "Default Speed Cafe" }}
      />
    );

    expect(screen.getByTestId("wifi-speed-badge")).toHaveTextContent("⚡ 250 Mbps");
    expect(screen.queryByTestId("wifi-quality-badge")).not.toBeInTheDocument();
  });

  it("renders appropriate quality label based on score threshold", () => {
    const { rerender } = render(
      <VenueWifiCard
        venue={{ id: "venue-q", name: "Q Cafe", wifiQuality: 3.8 }}
      />
    );
    expect(screen.getByTestId("wifi-quality-badge")).toHaveTextContent("Good Quality");

    rerender(
      <VenueWifiCard
        venue={{ id: "venue-q", name: "Q Cafe", wifiQuality: 2.9 }}
      />
    );
    expect(screen.getByTestId("wifi-quality-badge")).toHaveTextContent("Fair Quality");

    rerender(
      <VenueWifiCard
        venue={{ id: "venue-q", name: "Q Cafe", wifiQuality: 1.5 }}
      />
    );
    expect(screen.getByTestId("wifi-quality-badge")).toHaveTextContent("Basic Quality");
  });

  it("opens connect modal and triggers onConnectClick callback", () => {
    const handleConnectClick = jest.fn();
    render(
      <VenueWifiCard
        venue={baseVenue}
        onConnectClick={handleConnectClick}
      />
    );

    const button = screen.getByTestId("wifi-connect-btn");
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("mock-wifi-modal")).not.toBeInTheDocument();

    fireEvent.click(button);

    expect(handleConnectClick).toHaveBeenCalledTimes(1);
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("mock-wifi-modal")).toBeInTheDocument();
    expect(screen.getByTestId("mock-modal-venue")).toHaveTextContent("Cyber Cafe Oasis");

    // Close modal
    fireEvent.click(screen.getByTestId("mock-close-btn"));
    expect(screen.queryByTestId("mock-wifi-modal")).not.toBeInTheDocument();
  });

  it("applies custom className and testId", () => {
    render(
      <VenueWifiCard
        venue={baseVenue}
        className="custom-wifi-glow"
        testId="custom-wifi-card"
      />
    );

    const card = screen.getByTestId("custom-wifi-card");
    expect(card).toHaveClass("custom-wifi-glow");
  });
});

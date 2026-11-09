import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { VenueCheckInButton } from "@/components/venues/VenueCheckInButton";

describe("VenueCheckInButton Component", () => {
  let mockVibrate: jest.Mock;

  beforeEach(() => {
    mockVibrate = jest.fn().mockReturnValue(true);
    Object.defineProperty(navigator, "vibrate", {
      value: mockVibrate,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("renders with default 'Check In' text and icon", () => {
    render(<VenueCheckInButton venueId="venue-123" venueName="The Hive Cafe" />);

    const button = screen.getByRole("button", { name: /check in to the hive cafe/i });
    expect(button).toBeInTheDocument();
    expect(button).toHaveTextContent("Check In");
  });

  it("fires success haptic pattern ([15, 50, 20]) on successful check-in confirmation", async () => {
    const handleCheckIn = jest.fn().mockResolvedValue(true);
    const handleSuccess = jest.fn();

    render(
      <VenueCheckInButton
        venueId="venue-123"
        venueName="Nomad Space"
        onCheckIn={handleCheckIn}
        onSuccess={handleSuccess}
      />
    );

    const button = screen.getByRole("button");
    fireEvent.click(button);

    await waitFor(() => {
      expect(handleCheckIn).toHaveBeenCalledTimes(1);
      expect(handleSuccess).toHaveBeenCalledTimes(1);
      expect(mockVibrate).toHaveBeenCalledWith([15, 50, 20]);
    });

    expect(screen.getByText("Checked In")).toBeInTheDocument();
  });

  it("fires error haptic pattern ([50, 100, 50]) when check-in fails", async () => {
    const handleCheckIn = jest.fn().mockRejectedValue(new Error("Seat unavailable"));
    const handleError = jest.fn();

    render(
      <VenueCheckInButton
        venueId="venue-123"
        onCheckIn={handleCheckIn}
        onError={handleError}
      />
    );

    const button = screen.getByRole("button");
    fireEvent.click(button);

    await waitFor(() => {
      expect(handleCheckIn).toHaveBeenCalledTimes(1);
      expect(handleError).toHaveBeenCalledTimes(1);
      expect(mockVibrate).toHaveBeenCalledWith([50, 100, 50]);
    });

    expect(screen.getByText("Check In")).toBeInTheDocument();
  });

  it("fires error haptic pattern when onCheckIn resolves with false", async () => {
    const handleCheckIn = jest.fn().mockResolvedValue(false);
    const handleError = jest.fn();

    render(
      <VenueCheckInButton
        venueId="venue-123"
        onCheckIn={handleCheckIn}
        onError={handleError}
      />
    );

    const button = screen.getByRole("button");
    fireEvent.click(button);

    await waitFor(() => {
      expect(mockVibrate).toHaveBeenCalledWith([50, 100, 50]);
      expect(handleError).toHaveBeenCalled();
    });
  });

  it("falls back gracefully when navigator.vibrate is undefined or throws", async () => {
    Object.defineProperty(navigator, "vibrate", {
      value: undefined,
      writable: true,
      configurable: true,
    });

    const handleCheckIn = jest.fn().mockResolvedValue(true);
    const handleSuccess = jest.fn();

    expect(() => {
      render(
        <VenueCheckInButton
          venueId="venue-123"
          onCheckIn={handleCheckIn}
          onSuccess={handleSuccess}
        />
      );
      fireEvent.click(screen.getByRole("button"));
    }).not.toThrow();

    await waitFor(() => {
      expect(handleCheckIn).toHaveBeenCalledTimes(1);
      expect(handleSuccess).toHaveBeenCalledTimes(1);
    });

    expect(screen.getByText("Checked In")).toBeInTheDocument();
  });

  it("does not trigger check-in or haptics when disabled", () => {
    const handleCheckIn = jest.fn();

    render(
      <VenueCheckInButton
        venueId="venue-123"
        disabled
        onCheckIn={handleCheckIn}
      />
    );

    const button = screen.getByRole("button");
    fireEvent.click(button);

    expect(handleCheckIn).not.toHaveBeenCalled();
    expect(mockVibrate).not.toHaveBeenCalled();
  });

  it("does not trigger haptics when enableHaptics is false", async () => {
    const handleCheckIn = jest.fn().mockResolvedValue(true);

    render(
      <VenueCheckInButton
        venueId="venue-123"
        enableHaptics={false}
        onCheckIn={handleCheckIn}
      />
    );

    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => {
      expect(handleCheckIn).toHaveBeenCalledTimes(1);
    });

    expect(mockVibrate).not.toHaveBeenCalled();
  });
});

import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { GeoCheckInReminderBanner } from "@/components/bookings/GeoCheckInReminderBanner";
import * as geoHookModule from "@/hooks/useGeoProximityCheckIn";

jest.mock("@/hooks/useGeoProximityCheckIn");

describe("GeoCheckInReminderBanner Component", () => {
  const mockBooking = {
    id: "booking-1",
    date: "2026-10-30",
    time: "14:00",
    duration: 120,
    seatNumber: "Desk 4A",
    status: "CONFIRMED",
    venue: {
      id: "v1",
      name: "Innovation Hub",
      address: "123 Tech Park Ave",
      latitude: 12.9716,
      longitude: 77.5946,
    },
  };

  const defaultHookState: geoHookModule.GeoProximityState = {
    targetBooking: mockBooking,
    distanceMeters: 45,
    isNearby: true,
    isTimeEligible: true,
    shouldShowReminder: true,
    isCheckedIn: false,
    isCheckingIn: false,
    autoCheckInEnabled: false,
    error: null,
    checkInSuccess: false,
    setAutoCheckInEnabled: jest.fn(),
    triggerCheckIn: jest.fn().mockResolvedValue(true),
    dismissReminder: jest.fn(),
    requestNotificationPermission: jest.fn().mockResolvedValue("granted"),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (geoHookModule.useGeoProximityCheckIn as jest.Mock).mockReturnValue(defaultHookState);
  });

  it("returns null when shouldShowReminder and checkInSuccess are both false", () => {
    (geoHookModule.useGeoProximityCheckIn as jest.Mock).mockReturnValue({
      ...defaultHookState,
      shouldShowReminder: false,
      checkInSuccess: false,
    });

    const { container } = render(<GeoCheckInReminderBanner bookings={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("defensively handles nullish bookings without crashing", () => {
    render(<GeoCheckInReminderBanner bookings={null} testId="test-banner" />);

    expect(geoHookModule.useGeoProximityCheckIn).toHaveBeenCalledWith([]);
    expect(screen.getByTestId("test-banner")).toBeInTheDocument();
  });

  it("renders nearby arrival reminder with geofence indicator, distance, and venue info", () => {
    render(
      <GeoCheckInReminderBanner
        bookings={[mockBooking]}
        testId="test-banner"
        className="custom-banner-class"
      />
    );

    expect(screen.getByTestId("test-banner")).toHaveClass("custom-banner-class");
    expect(screen.getByTestId("test-banner-venue-name")).toHaveTextContent("Innovation Hub");
    expect(screen.getByTestId("test-banner-distance")).toHaveTextContent("45m away");
    expect(screen.getByTestId("test-banner-status-pill")).toHaveTextContent(
      "Arrived · Inside Venue Geofence"
    );
    expect(screen.getByTestId("test-banner-time-duration")).toHaveTextContent("14:00 (120 min)");
    expect(screen.getByTestId("test-banner-seat-number")).toHaveTextContent("Seat: Desk 4A");
    expect(screen.getByTestId("test-banner-venue-address")).toHaveTextContent("123 Tech Park Ave");
  });

  it("renders upcoming reminder when not nearby (isNearby=false)", () => {
    (geoHookModule.useGeoProximityCheckIn as jest.Mock).mockReturnValue({
      ...defaultHookState,
      isNearby: false,
      distanceMeters: 450,
    });

    render(<GeoCheckInReminderBanner bookings={[mockBooking]} testId="test-banner" />);

    expect(screen.getByTestId("test-banner-status-pill")).toHaveTextContent(
      "Upcoming Check-In Reminder"
    );
    expect(screen.getByTestId("test-banner-pin-icon")).toBeInTheDocument();
    expect(screen.getByTestId("test-banner-distance")).toHaveTextContent("450m away");
  });

  it("triggers check-in action and onCheckInSuccess callback", async () => {
    const onCheckInSuccess = jest.fn();
    const triggerCheckIn = jest.fn().mockResolvedValue(true);

    (geoHookModule.useGeoProximityCheckIn as jest.Mock).mockReturnValue({
      ...defaultHookState,
      triggerCheckIn,
    });

    render(
      <GeoCheckInReminderBanner
        bookings={[mockBooking]}
        onCheckInSuccess={onCheckInSuccess}
        testId="test-banner"
      />
    );

    const checkInBtn = screen.getByTestId("test-banner-checkin-btn");
    fireEvent.click(checkInBtn);

    await waitFor(() => {
      expect(triggerCheckIn).toHaveBeenCalledTimes(1);
      expect(onCheckInSuccess).toHaveBeenCalledTimes(1);
    });
  });

  it("toggles auto check-in checkbox", () => {
    const setAutoCheckInEnabled = jest.fn();

    (geoHookModule.useGeoProximityCheckIn as jest.Mock).mockReturnValue({
      ...defaultHookState,
      autoCheckInEnabled: false,
      setAutoCheckInEnabled,
    });

    render(<GeoCheckInReminderBanner bookings={[mockBooking]} testId="test-banner" />);

    const checkbox = screen.getByTestId("test-banner-autocheckin-checkbox");
    fireEvent.click(checkbox);

    expect(setAutoCheckInEnabled).toHaveBeenCalledWith(true);
  });

  it("calls dismissReminder when dismiss button is clicked", () => {
    const dismissReminder = jest.fn();

    (geoHookModule.useGeoProximityCheckIn as jest.Mock).mockReturnValue({
      ...defaultHookState,
      dismissReminder,
    });

    render(<GeoCheckInReminderBanner bookings={[mockBooking]} testId="test-banner" />);

    const dismissBtn = screen.getByTestId("test-banner-dismiss-btn");
    fireEvent.click(dismissBtn);

    expect(dismissReminder).toHaveBeenCalledTimes(1);
  });

  it("renders check-in success state", () => {
    (geoHookModule.useGeoProximityCheckIn as jest.Mock).mockReturnValue({
      ...defaultHookState,
      shouldShowReminder: false,
      checkInSuccess: true,
    });

    render(<GeoCheckInReminderBanner bookings={[mockBooking]} testId="test-banner" />);

    expect(screen.getByTestId("test-banner-success")).toBeInTheDocument();
    expect(screen.getByTestId("test-banner-success-title")).toHaveTextContent(
      "Checked in to Innovation Hub!"
    );
    expect(screen.getByTestId("test-banner-success-subtitle")).toHaveTextContent("Seat Desk 4A");
  });

  it("displays error message when hook reports an error", () => {
    (geoHookModule.useGeoProximityCheckIn as jest.Mock).mockReturnValue({
      ...defaultHookState,
      error: "Location request timed out",
    });

    render(<GeoCheckInReminderBanner bookings={[mockBooking]} testId="test-banner" />);

    expect(screen.getByTestId("test-banner-error")).toHaveTextContent(
      "Location request timed out"
    );
  });
});

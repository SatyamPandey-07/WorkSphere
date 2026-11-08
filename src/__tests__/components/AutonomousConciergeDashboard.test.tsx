import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  AutonomousConciergeDashboard,
  SESSION_STORAGE_DISMISSED_KEY,
  ConciergeNotification,
} from "@/components/AutonomousConciergeDashboard";

describe("AutonomousConciergeDashboard", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    sessionStorage.clear();
  });

  afterEach(() => {
    jest.useRealTimers();
    sessionStorage.clear();
  });

  const testNotifications: ConciergeNotification[] = [
    {
      id: "test-rec-1",
      title: "Quiet Focus Pod Available",
      message: "Pod 4 in West Wing has low ambient noise.",
      type: "recommendation",
      timestamp: "5m ago",
      category: "Focus Zone",
    },
    {
      id: "test-rec-2",
      title: "High Noise Level Alert",
      message: "Central Atrium noise level is above 75dB.",
      type: "alert",
      timestamp: "12m ago",
      category: "Noise Alert",
    },
  ];

  it("renders default notifications when no custom ones are provided", () => {
    render(<AutonomousConciergeDashboard />);

    expect(screen.getByText("Autonomous Concierge")).toBeInTheDocument();
    expect(screen.getByText("Quiet Workspace Recommendation")).toBeInTheDocument();
    expect(screen.getByText("Peak Noise Alert Avoidance")).toBeInTheDocument();
  });

  it("renders custom notifications provided via props", () => {
    render(<AutonomousConciergeDashboard notifications={testNotifications} />);

    expect(screen.getByText("Quiet Focus Pod Available")).toBeInTheDocument();
    expect(screen.getByText("High Noise Level Alert")).toBeInTheDocument();
  });

  it("dismisses a notification with smooth fade out and saves ID to sessionStorage", () => {
    const onDismissNotificationMock = jest.fn();
    render(
      <AutonomousConciergeDashboard
        notifications={testNotifications}
        onDismissNotification={onDismissNotificationMock}
      />
    );

    const dismissBtn = screen.getByTestId("dismiss-button-test-rec-1");
    expect(dismissBtn).toBeInTheDocument();

    // Click dismiss button
    fireEvent.click(dismissBtn);

    // Verify fading out class applied immediately
    const banner = screen.getByTestId("concierge-notification-test-rec-1");
    expect(banner.className).toContain("opacity-0");

    // Fast-forward 300ms for transition timeout
    act(() => {
      jest.advanceTimersByTime(300);
    });

    // Notification should no longer be displayed
    expect(
      screen.queryByTestId("concierge-notification-test-rec-1")
    ).not.toBeInTheDocument();

    // Callback should be called
    expect(onDismissNotificationMock).toHaveBeenCalledWith("test-rec-1");

    // Session storage should persist dismissed ID
    const stored = sessionStorage.getItem(SESSION_STORAGE_DISMISSED_KEY);
    expect(stored).not.toBeNull();
    expect(JSON.parse(stored!)).toContain("test-rec-1");
  });

  it("restores dismissed notifications when sessionStorage already contains dismissed IDs on mount", () => {
    sessionStorage.setItem(
      SESSION_STORAGE_DISMISSED_KEY,
      JSON.stringify(["test-rec-1"])
    );

    render(<AutonomousConciergeDashboard notifications={testNotifications} />);

    // test-rec-1 should be hidden initially based on sessionStorage
    expect(
      screen.queryByTestId("concierge-notification-test-rec-1")
    ).not.toBeInTheDocument();

    // test-rec-2 should still be visible
    expect(
      screen.getByTestId("concierge-notification-test-rec-2")
    ).toBeInTheDocument();
  });

  it("shows empty state when all notifications are dismissed and supports reset", () => {
    render(<AutonomousConciergeDashboard notifications={testNotifications} />);

    // Dismiss first
    fireEvent.click(screen.getByTestId("dismiss-button-test-rec-1"));
    act(() => {
      jest.advanceTimersByTime(300);
    });

    // Dismiss second
    fireEvent.click(screen.getByTestId("dismiss-button-test-rec-2"));
    act(() => {
      jest.advanceTimersByTime(300);
    });

    // Empty state should be visible
    expect(screen.getByTestId("no-concierge-notifications")).toBeInTheDocument();
    expect(screen.getByText("All caught up!")).toBeInTheDocument();

    // Reset button should restore notifications
    const resetButton = screen.getByRole("button", {
      name: /Reset Dismissed|Show 2 dismissed notifications/i,
    });
    fireEvent.click(resetButton);

    expect(
      screen.getByTestId("concierge-notification-test-rec-1")
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("concierge-notification-test-rec-2")
    ).toBeInTheDocument();
    expect(
      sessionStorage.getItem(SESSION_STORAGE_DISMISSED_KEY)
    ).toBeNull();
  });
});

import React from "react";
import { render, screen } from "@testing-library/react";
import {
  RoomHeaderConnectionStatus,
  RoomHeaderConnectionStatusProps,
} from "@/components/realtime/RoomHeaderConnectionStatus";

describe("RoomHeaderConnectionStatus Component", () => {
  it("renders 'Connected' state with emerald styling and Wifi icon", () => {
    render(<RoomHeaderConnectionStatus status="connected" />);

    const badge = screen.getByTestId("room-status-connected");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveAttribute("role", "status");
    expect(badge).toHaveAttribute("aria-live", "polite");
    expect(badge).toHaveAttribute(
      "aria-label",
      "Room connection status: connected",
    );
    expect(badge).toHaveAttribute("data-status", "connected");
    expect(screen.getByText("Connected")).toBeInTheDocument();
  });

  it("renders 'Reconnecting...' state with amber styling and spinner when attempt is 0", () => {
    render(
      <RoomHeaderConnectionStatus status="reconnecting" reconnectAttempt={0} />,
    );

    const badge = screen.getByTestId("room-status-reconnecting");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveAttribute("data-status", "reconnecting");
    expect(badge).toHaveAttribute(
      "aria-label",
      "Room connection status: reconnecting",
    );
    expect(screen.getByText("Reconnecting...")).toBeInTheDocument();
  });

  it("renders 'Reconnecting (4)...' state when reconnectAttempt is 4", () => {
    render(
      <RoomHeaderConnectionStatus status="reconnecting" reconnectAttempt={4} />,
    );

    const badge = screen.getByTestId("room-status-reconnecting");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveAttribute(
      "aria-label",
      "Room connection status: reconnecting (4)",
    );
    expect(screen.getByText("Reconnecting (4)...")).toBeInTheDocument();
  });

  it("sanitizes float, negative, and NaN reconnectAttempt values", () => {
    const { rerender } = render(
      <RoomHeaderConnectionStatus
        status="reconnecting"
        reconnectAttempt={2.9}
      />,
    );
    expect(screen.getByText("Reconnecting (2)...")).toBeInTheDocument();

    rerender(
      <RoomHeaderConnectionStatus status="reconnecting" reconnectAttempt={-3} />,
    );
    expect(screen.getByText("Reconnecting...")).toBeInTheDocument();

    rerender(
      <RoomHeaderConnectionStatus status="reconnecting" reconnectAttempt={NaN} />,
    );
    expect(screen.getByText("Reconnecting...")).toBeInTheDocument();
  });

  it("renders 'Offline' state with rose styling and WifiOff icon when status is 'offline'", () => {
    render(<RoomHeaderConnectionStatus status="offline" />);

    const badge = screen.getByTestId("room-status-offline");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveAttribute("data-status", "offline");
    expect(badge).toHaveAttribute(
      "aria-label",
      "Room connection status: offline",
    );
    expect(screen.getByText("Offline")).toBeInTheDocument();
  });

  it("defaults to 'offline' state when status is omitted or undefined", () => {
    render(<RoomHeaderConnectionStatus />);

    const badge = screen.getByTestId("room-status-offline");
    expect(badge).toBeInTheDocument();
    expect(screen.getByText("Offline")).toBeInTheDocument();
  });

  it("falls back to 'offline' state when an unexpected status string is provided", () => {
    render(
      <RoomHeaderConnectionStatus status={"disconnected" as any} />,
    );

    const badge = screen.getByTestId("room-status-offline");
    expect(badge).toBeInTheDocument();
    expect(screen.getByText("Offline")).toBeInTheDocument();
  });

  it("merges custom className prop correctly via cn()", () => {
    render(
      <RoomHeaderConnectionStatus
        status="connected"
        className="custom-room-badge"
      />,
    );

    const badge = screen.getByTestId("room-status-connected");
    expect(badge).toHaveClass("custom-room-badge");
  });
});

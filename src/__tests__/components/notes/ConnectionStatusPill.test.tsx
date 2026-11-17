/** @jest-environment jsdom */
import React from "react";
import { render, screen } from "@testing-library/react";
import { ConnectionStatusPill } from "@/components/notes/ConnectionStatusPill";

describe("ConnectionStatusPill", () => {
  it("renders connected state with green indicator and Connected label", () => {
    render(<ConnectionStatusPill status="connected" />);
    const pill = screen.getByTestId("connection-status-pill");
    expect(pill).toBeInTheDocument();
    expect(pill).toHaveAttribute("data-status", "connected");
    expect(screen.getByText("Connected")).toBeInTheDocument();
    expect(pill).toHaveAttribute("aria-label", "Connection status: Connected");
  });

  it("renders reconnecting state with amber indicator and Reconnecting... label", () => {
    render(<ConnectionStatusPill status="connecting" />);
    const pill = screen.getByTestId("connection-status-pill");
    expect(pill).toBeInTheDocument();
    expect(pill).toHaveAttribute("data-status", "connecting");
    expect(screen.getByText("Reconnecting...")).toBeInTheDocument();
    expect(pill).toHaveAttribute(
      "aria-label",
      "Connection status: Reconnecting",
    );
  });

  it("renders offline state with Offline label", () => {
    render(<ConnectionStatusPill status="disconnected" />);
    const pill = screen.getByTestId("connection-status-pill");
    expect(pill).toBeInTheDocument();
    expect(pill).toHaveAttribute("data-status", "disconnected");
    expect(screen.getByText("Offline")).toBeInTheDocument();
    expect(pill).toHaveAttribute("aria-label", "Connection status: Offline");
  });

  it("indicates unsynchronized changes when offline with pending edits", () => {
    render(<ConnectionStatusPill status="disconnected" pendingCount={4} />);
    expect(screen.getByText("Offline")).toBeInTheDocument();
    expect(screen.getByTestId("pill-unsynced-indicator")).toHaveTextContent(
      "(4 unsynced)",
    );
    const pill = screen.getByTestId("connection-status-pill");
    expect(pill).toHaveAttribute(
      "aria-label",
      "Connection status: Offline, 4 unsynchronized changes",
    );
  });
});

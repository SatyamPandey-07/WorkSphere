import React from "react";
import { render, screen } from "@testing-library/react";
import {
  ConnectionStatus,
  ConnectionStatusProps,
} from "@/components/realtime/ConnectionStatus";

describe("ConnectionStatus Component", () => {
  it("renders 'Live' state when isConnected is true", () => {
    render(<ConnectionStatus isConnected={true} />);

    const el = screen.getByTestId("connection-status");
    expect(el).toBeInTheDocument();
    expect(el).toHaveAttribute("data-status", "connected");
    expect(el).toHaveAttribute("role", "status");
    expect(el).toHaveAttribute("aria-live", "polite");
    expect(el).toHaveAttribute("aria-label", "Connection status: connected");
    expect(screen.getByText("Live")).toBeInTheDocument();
    expect(screen.getByTestId("lantern-power-core")).toBeInTheDocument();
  });

  it("renders 'Live' state when status prop is 'connected'", () => {
    render(<ConnectionStatus status="connected" />);

    const el = screen.getByTestId("connection-status");
    expect(el).toHaveAttribute("data-status", "connected");
    expect(screen.getByText("Live")).toBeInTheDocument();
  });

  it("renders 'Connecting...' state when status prop is 'connecting'", () => {
    render(<ConnectionStatus status="connecting" />);

    const el = screen.getByTestId("connection-status");
    expect(el).toHaveAttribute("data-status", "connecting");
    expect(el).toHaveAttribute("aria-label", "Connection status: connecting");
    expect(screen.getByText("Connecting...")).toBeInTheDocument();
    expect(screen.queryByTestId("lantern-power-core")).not.toBeInTheDocument();
  });

  it("renders 'Reconnecting...' state when status prop is 'reconnecting'", () => {
    render(<ConnectionStatus status="reconnecting" />);

    const el = screen.getByTestId("connection-status");
    expect(el).toHaveAttribute("data-status", "reconnecting");
    expect(el).toHaveAttribute("aria-label", "Connection status: reconnecting");
    expect(screen.getByText("Reconnecting...")).toBeInTheDocument();
  });

  it("renders 'Reconnecting...' state when isConnected is false and status is omitted", () => {
    render(<ConnectionStatus isConnected={false} />);

    const el = screen.getByTestId("connection-status");
    expect(el).toHaveAttribute("data-status", "reconnecting");
    expect(screen.getByText("Reconnecting...")).toBeInTheDocument();
  });

  it("renders 'Offline' state when status prop is 'disconnected'", () => {
    render(<ConnectionStatus status="disconnected" />);

    const el = screen.getByTestId("connection-status");
    expect(el).toHaveAttribute("data-status", "disconnected");
    expect(el).toHaveAttribute("aria-label", "Connection status: disconnected");
    expect(screen.getByText("Offline")).toBeInTheDocument();
  });

  it("renders 'Offline' state when status prop is 'offline'", () => {
    render(<ConnectionStatus status="offline" />);

    const el = screen.getByTestId("connection-status");
    expect(el).toHaveAttribute("data-status", "disconnected");
    expect(screen.getByText("Offline")).toBeInTheDocument();
  });

  it("defaults to 'connecting' state when no props are provided", () => {
    render(<ConnectionStatus />);

    const el = screen.getByTestId("connection-status");
    expect(el).toHaveAttribute("data-status", "connecting");
    expect(screen.getByText("Connecting...")).toBeInTheDocument();
  });

  it("prioritizes status prop over isConnected when both are passed", () => {
    render(<ConnectionStatus isConnected={true} status="disconnected" />);

    const el = screen.getByTestId("connection-status");
    expect(el).toHaveAttribute("data-status", "disconnected");
    expect(screen.getByText("Offline")).toBeInTheDocument();
  });

  it("falls back to connecting when an unrecognized status string is passed", () => {
    render(<ConnectionStatus status={"unknown-state" as any} />);

    const el = screen.getByTestId("connection-status");
    expect(el).toHaveAttribute("data-status", "connecting");
    expect(screen.getByText("Connecting...")).toBeInTheDocument();
  });

  it("merges custom className prop correctly", () => {
    render(<ConnectionStatus status="connected" className="custom-test-badge" />);

    const el = screen.getByTestId("connection-status");
    expect(el).toHaveClass("custom-test-badge");
  });
});

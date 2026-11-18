import React from "react";
import { render, screen, fireEvent, act, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { TacticalAirTrafficControlBoard } from "@/components/admin/TacticalAirTrafficControlBoard";
import { AutonomousConciergeDashboard } from "@/components/ai/AutonomousConciergeDashboard";

const mockSend = jest.fn();
let capturedSocketOpts: {
  onOpen?: () => void;
  onClose?: () => void;
  onError?: () => void;
  onMessage?: (event: { data: string }) => void;
} = {};

jest.mock("@/hooks/usePartySocketReconnect", () => ({
  __esModule: true,
  default: jest.fn((opts) => {
    capturedSocketOpts = opts;
    return { send: mockSend };
  }),
}));

describe("TacticalAirTrafficControlBoard (#6332)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    capturedSocketOpts = {};
    Element.prototype.scrollIntoView = jest.fn();
  });

  it("renders full-screen vector radar map with compass rose, range rings, and flight tags", () => {
    render(<TacticalAirTrafficControlBoard />);

    // Radar Board & Scope
    expect(
      screen.getByTestId("tactical-air-traffic-control-board"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("atc-primary-radar")).toBeInTheDocument();

    // Range rings & compass labels
    expect(screen.getByText(/360° N/i)).toBeInTheDocument();
    expect(screen.getByText(/090° E/i)).toBeInTheDocument();
    expect(screen.getByText(/180° S/i)).toBeInTheDocument();
    expect(screen.getByText(/270° W/i)).toBeInTheDocument();
    expect(screen.getByText("5 NM")).toBeInTheDocument();
    expect(screen.getByText("25 NM")).toBeInTheDocument();

    // Tactical Flight Tags
    expect(screen.getByTestId("tactical-flight-tag-fl-101")).toBeInTheDocument();
    expect(screen.getByTestId("tactical-flight-tag-fl-102")).toBeInTheDocument();
    expect(screen.getByTestId("tactical-flight-tag-fl-103")).toBeInTheDocument();

    // Flight callsign and member text
    const tag101 = screen.getByTestId("tactical-flight-tag-fl-101");
    expect(within(tag101).getByText("WS-101")).toBeInTheDocument();
    expect(within(tag101).getByText("Sarah Jenkins")).toBeInTheDocument();

    const tag102 = screen.getByTestId("tactical-flight-tag-fl-102");
    expect(within(tag102).getByText("WS-204")).toBeInTheDocument();
    expect(within(tag102).getByText("David Kim")).toBeInTheDocument();
  });

  it("displays flight telemetry HUD when a flight blip or tag is selected", () => {
    render(<TacticalAirTrafficControlBoard />);

    // Click David Kim's flight tag (fl-102)
    const flightBlip = screen.getByTestId("flight-blip-fl-102");
    fireEvent.click(flightBlip);

    // Telemetry HUD shows target lock details
    const hud = screen.getByTestId("target-telemetry-hud");
    expect(hud).toBeInTheDocument();
    expect(within(hud).getByText(/Target Lock \/\/ WS-204/i)).toBeInTheDocument();
    expect(within(hud).getByText("David Kim")).toBeInTheDocument();
    expect(within(hud).getAllByText(/Sector-02 \/\/ Glass Atrium/i).length).toBeGreaterThanOrEqual(1);
    expect(within(hud).getByText("SQ-7600")).toBeInTheDocument();

    // Radar reticle appears on selected flight
    expect(screen.getByTestId("radar-reticle")).toBeInTheDocument();
  });

  it("filters targets by alert categories: high occupancy, latency spikes, and hazards", () => {
    render(<TacticalAirTrafficControlBoard />);

    // Click HIGH OCCUPANCY filter
    const highOccBtn = screen.getByTestId("filter-high-occupancy");
    fireEvent.click(highOccBtn);

    // Only flights in Sector-02 Glass Atrium (or with high occupancy alert) shown
    expect(screen.getByTestId("tactical-flight-tag-fl-102")).toBeInTheDocument(); // David Kim
    expect(screen.getByTestId("tactical-flight-tag-fl-104")).toBeInTheDocument(); // Marcus Chen
    // Normal occupancy flight fl-103 (Sector-03 Library) should be hidden
    expect(screen.queryByTestId("tactical-flight-tag-fl-103")).not.toBeInTheDocument();

    // Click LATENCY SPIKES filter
    const latencyBtn = screen.getByTestId("filter-latency-spikes");
    fireEvent.click(latencyBtn);

    // Flights with latency >= 50ms
    expect(screen.getByTestId("tactical-flight-tag-fl-102")).toBeInTheDocument();
    expect(screen.getByTestId("tactical-flight-tag-fl-104")).toBeInTheDocument();
    expect(screen.queryByTestId("tactical-flight-tag-fl-103")).not.toBeInTheDocument();

    // Click HAZARDS filter
    const hazardsBtn = screen.getByTestId("filter-hazards");
    fireEvent.click(hazardsBtn);

    // Emergency rainstorm squawk SQ-7700
    expect(screen.getByTestId("tactical-flight-tag-fl-101")).toBeInTheDocument();
    expect(screen.queryByTestId("tactical-flight-tag-fl-103")).not.toBeInTheDocument();

    // Reset to ALL
    const allBtn = screen.getByTestId("filter-all-targets");
    fireEvent.click(allBtn);
    expect(screen.getByTestId("tactical-flight-tag-fl-103")).toBeInTheDocument();
  });

  it("filters targets by search query", () => {
    render(<TacticalAirTrafficControlBoard />);

    const searchInput = screen.getByTestId("atc-search-input");
    fireEvent.change(searchInput, { target: { value: "Jenkins" } });

    expect(screen.getByTestId("tactical-flight-tag-fl-101")).toBeInTheDocument();
    expect(screen.queryByTestId("tactical-flight-tag-fl-102")).not.toBeInTheDocument();
    expect(screen.queryByTestId("tactical-flight-tag-fl-103")).not.toBeInTheDocument();
  });

  it("handles live WebSocket events from PartyKit room", () => {
    render(<TacticalAirTrafficControlBoard />);

    // Trigger onOpen
    act(() => {
      capturedSocketOpts.onOpen?.();
    });

    const connStatus = screen.getByTestId("ws-connection-status");
    expect(connStatus).toHaveTextContent("LIVE WEBSOCKET");

    // Receive incoming USER_CHECKIN event
    act(() => {
      capturedSocketOpts.onMessage?.({
        data: JSON.stringify({
          type: "USER_CHECKIN",
          payload: {
            id: "fl-999",
            callsign: "WS-999",
            name: "Commander Shepard",
            type: "checkin",
            sectorId: "zone-orbital-nexus",
            sectorName: "Sector-05 // Orbital Nexus",
            deskId: "Desk-Nexus-10",
            altitude: "FL300",
            heading: 0,
            speedKnots: 500,
            squawk: "SQ-0007",
            status: "CHECKED_IN",
            latencyMs: 14,
            pos: { x: 50, y: 48 },
          },
        }),
      });
    });

    expect(screen.getByTestId("tactical-flight-tag-fl-999")).toBeInTheDocument();
    expect(screen.getByText("WS-999")).toBeInTheDocument();
    expect(screen.getByText("Commander Shepard")).toBeInTheDocument();
  });

  it("dispatches relocation flight command over PartySocket WebSocket", () => {
    render(<TacticalAirTrafficControlBoard />);

    // Open connection
    act(() => {
      capturedSocketOpts.onOpen?.();
    });

    // Select flight fl-101 with critical recommendation
    fireEvent.click(screen.getByTestId("flight-blip-fl-101"));

    const dispatchBtn = screen.getByTestId("dispatch-relocation-btn");
    expect(dispatchBtn).toBeInTheDocument();

    fireEvent.click(dispatchBtn);

    // Verify WebSocket frame sent
    expect(mockSend).toHaveBeenCalledWith(
      expect.stringContaining("DISPATCH_INTERCEPT"),
    );
    expect(mockSend).toHaveBeenCalledWith(
      expect.stringContaining("fl-101"),
    );
  });

  it("supports acknowledging all active DEFCON alerts", () => {
    render(<TacticalAirTrafficControlBoard />);

    const alertTicker = screen.getByTestId("atc-alert-ticker");
    expect(alertTicker).toBeInTheDocument();
    expect(alertTicker).toHaveTextContent(/DEFCON 2 ALERT/i);

    const ackBtn = screen.getByTestId("ack-alerts-btn");
    fireEvent.click(ackBtn);

    // Alert acknowledged, ticker dismissed
    expect(screen.queryByTestId("atc-alert-ticker")).not.toBeInTheDocument();
  });

  it("allows toggling full-viewport mode and radar range zoom", () => {
    render(<TacticalAirTrafficControlBoard />);

    const fullscreenToggle = screen.getByTestId("atc-fullscreen-toggle");
    fireEvent.click(fullscreenToggle);

    const board = screen.getByTestId("tactical-air-traffic-control-board");
    expect(board).toHaveClass("fixed");

    // Click 50NM range button
    const range50Btn = screen.getByTestId("range-btn-50");
    fireEvent.click(range50Btn);
    expect(screen.getByTestId("selected-range-label")).toHaveTextContent("RANGE: 50 NM");
  });
});

describe("AutonomousConciergeDashboard - TacticalAirTrafficControlBoard Integration (#6332)", () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = jest.fn();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("renders toggle button and mounts TacticalAirTrafficControlBoard when engaged", () => {
    render(<AutonomousConciergeDashboard />);

    const toggleBtn = screen.getByTestId("toggle-atc-radar-view");
    expect(toggleBtn).toBeInTheDocument();
    expect(toggleBtn).toHaveTextContent(/PRIMARY ATC RADAR/i);

    // Initially standard mission control view is active
    expect(screen.getByTestId("tactical-command-panel")).toBeInTheDocument();
    expect(screen.queryByTestId("atc-radar-view-container")).not.toBeInTheDocument();

    // Toggle to ATC Radar view
    fireEvent.click(toggleBtn);

    expect(screen.getByTestId("atc-radar-view-container")).toBeInTheDocument();
    expect(screen.getByTestId("tactical-air-traffic-control-board")).toBeInTheDocument();
    expect(toggleBtn).toHaveTextContent(/MISSION CONTROL VIEW/i);

    // Toggle back to standard view
    fireEvent.click(toggleBtn);
    expect(screen.queryByTestId("atc-radar-view-container")).not.toBeInTheDocument();
    expect(screen.getByTestId("tactical-command-panel")).toBeInTheDocument();
  });
});

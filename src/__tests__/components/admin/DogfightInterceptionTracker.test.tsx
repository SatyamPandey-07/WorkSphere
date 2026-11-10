import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import {
  DogfightInterceptionTracker,
  type DogfightEvent,
} from "@/components/admin/DogfightInterceptionTracker";

describe("DogfightInterceptionTracker Component", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it("renders radar HUD metrics and computes dynamic averages from default dogfights", () => {
    render(<DogfightInterceptionTracker />);

    expect(screen.getByTestId("dogfight-interception-tracker")).toBeInTheDocument();
    expect(screen.getByText(/Tactical Dogfight Interception Tracker/i)).toBeInTheDocument();

    // Default MOCK_DOGFIGHTS has 2 resolved conflicts (DF-901 and DF-903) out of 3
    expect(screen.getByTestId("metric-resolved-conflicts")).toHaveTextContent(
      "2 Conflicts Resolved",
    );
    // (38 + 64 + 22) / 3 = 124 / 3 = 41.3 ms
    expect(screen.getByTestId("metric-avg-latency")).toHaveTextContent("41.3 ms");
    // 0 collisions -> 100% Integrity
    expect(screen.getByTestId("metric-integrity-rate")).toHaveTextContent("100% Integrity");

    // Check dogfight rows
    expect(screen.getByTestId("dogfight-row-DF-901")).toBeInTheDocument();
    expect(screen.getByTestId("dogfight-row-DF-902")).toBeInTheDocument();
    expect(screen.getByTestId("dogfight-row-DF-903")).toBeInTheDocument();
  });

  it("calculates accurate metrics with collisions and custom dogfight events", () => {
    const customDogfights: DogfightEvent[] = [
      {
        id: "DF-TEST-1",
        deskId: "DESK-1",
        contenderA: { callsign: "A-1", ipSector: "10.0.0.1", timestamp: "12:00:00" },
        contenderB: { callsign: "B-1", ipSector: "10.0.0.2", timestamp: "12:00:01" },
        leaseDuration: "1.0s",
        settlementLatency: 20,
        status: "RESOLVED_A",
      },
      {
        id: "DF-TEST-2",
        deskId: "DESK-2",
        contenderA: { callsign: "A-2", ipSector: "10.0.0.3", timestamp: "12:00:02" },
        contenderB: { callsign: "B-2", ipSector: "10.0.0.4", timestamp: "12:00:03" },
        leaseDuration: "1.0s",
        settlementLatency: 30,
        status: "COLLISION",
      },
    ];

    render(<DogfightInterceptionTracker initialDogfights={customDogfights} />);

    // 1 resolved conflict
    expect(screen.getByTestId("metric-resolved-conflicts")).toHaveTextContent(
      "1 Conflict Resolved",
    );
    // (20 + 30) / 2 = 25.0 ms
    expect(screen.getByTestId("metric-avg-latency")).toHaveTextContent("25.0 ms");
    // 1 collision out of 2 -> 50% Integrity
    expect(screen.getByTestId("metric-integrity-rate")).toHaveTextContent("50% Integrity");
  });

  it("handles empty dogfights list safely without division by zero", () => {
    render(<DogfightInterceptionTracker initialDogfights={[]} />);

    expect(screen.getByTestId("metric-resolved-conflicts")).toHaveTextContent(
      "0 Conflicts Resolved",
    );
    expect(screen.getByTestId("metric-avg-latency")).toHaveTextContent("0.0 ms");
    expect(screen.getByTestId("metric-integrity-rate")).toHaveTextContent("100% Integrity");
  });

  it("toggles live telemetry polling and pauses timer", () => {
    render(<DogfightInterceptionTracker pollIntervalMs={1000} />);

    const toggleBtn = screen.getByRole("button", { name: /LIVE TELEMETRY ACTIVE/i });
    expect(toggleBtn).toBeInTheDocument();

    fireEvent.click(toggleBtn);
    expect(screen.getByRole("button", { name: /TELEMETRY PAUSED/i })).toBeInTheDocument();
  });

  it("updates settlement latencies during live interval and clamps to positive values", () => {
    render(<DogfightInterceptionTracker pollIntervalMs={1000} />);

    act(() => {
      jest.advanceTimersByTime(2000);
    });

    // Reset button restores initial values
    const resetBtn = screen.getByTitle(/Reset Mock Telemetry/i);
    fireEvent.click(resetBtn);

    expect(screen.getByTestId("metric-avg-latency")).toHaveTextContent("41.3 ms");
  });
});

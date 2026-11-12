import "@testing-library/jest-dom";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import PowerGridReliabilityMonitorDefault, {
  PowerGridReliabilityMonitor,
} from "@/components/venue/PowerGridReliabilityMonitor";
import type { VenuePowerGridSummary } from "@/lib/telemetry/powerGridEngine";

const mockSubscribe = jest.fn().mockResolvedValue(true);
const mockUnsubscribe = jest.fn().mockResolvedValue(true);

jest.mock("@/hooks/usePushNotifications", () => ({
  usePushNotifications: () => ({
    isSupported: true,
    isSubscribed: false,
    permission: "granted",
    subscribe: mockSubscribe,
    unsubscribe: mockUnsubscribe,
    isLoading: false,
  }),
}));

const mockSummary: VenuePowerGridSummary = {
  venueId: "venue-sf-01",
  venueName: "Mission Focus Coworking & Cafe",
  gridStatus: "ONLINE_MAINS",
  generatorActive: false,
  overallGridHealthScore: 98,
  totalSocketsCount: 20,
  workingSocketsCount: 19,
  fastChargingCoveragePct: 85,
  nominalVoltageV: 120,
  nodes: [
    {
      seatId: "seat-1",
      seatNumber: "Desk A1",
      socketType: "USB_C_140W_PD",
      maxWattageW: 140,
      measuredVoltageV: 120.2,
      status: "OPERATIONAL_OPTIMAL",
      reliabilityScorePct: 99,
      lastVerifiedAt: "2026-10-30T10:00:00Z",
      reportedIssueCount: 0,
      outletLocation: "DESK_GROMMET",
    },
    {
      seatId: "seat-2",
      seatNumber: "Desk A2",
      socketType: "AC_UNIVERSAL_WALL",
      maxWattageW: 100,
      measuredVoltageV: 0,
      status: "DEAD_NO_POWER",
      reliabilityScorePct: 40,
      lastVerifiedAt: "2026-10-30T09:30:00Z",
      reportedIssueCount: 2,
      outletLocation: "WALL_MOUNTED",
    },
  ],
};

describe("PowerGridReliabilityMonitor Component Suite", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    global.fetch = jest.fn().mockImplementation((url: string, opts?: any) => {
      if (opts?.method === "POST") {
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true, message: "Issue logged" }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ success: true, summary: mockSummary }),
      });
    });
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it("exports default matching named export", () => {
    expect(PowerGridReliabilityMonitorDefault).toBe(PowerGridReliabilityMonitor);
  });

  it("renders header title and loading state initially", async () => {
    render(<PowerGridReliabilityMonitor />);

    expect(
      screen.getByText(/smart power grid & outlet voltage monitor/i)
    ).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByTestId("power-grid-reliability-monitor")).toBeInTheDocument();
      expect(screen.getByText("Desk A1")).toBeInTheDocument();
    });
  });

  it("renders telemetry statistics and desk nodes correctly", async () => {
    render(<PowerGridReliabilityMonitor venueId="venue-sf-01" />);

    await waitFor(() => {
      expect(screen.getByText("98%")).toBeInTheDocument();
      expect(screen.getByText("19 of 20 Outlets Operational")).toBeInTheDocument();
      expect(screen.getByText("85%")).toBeInTheDocument();
      expect(screen.getByText("120V")).toBeInTheDocument();
      expect(screen.getByText("Desk A1")).toBeInTheDocument();
      expect(screen.getByText("Desk A2")).toBeInTheDocument();
    });
  });

  it("renders status badge for ONLINE_MAINS", async () => {
    render(<PowerGridReliabilityMonitor />);

    await waitFor(() => {
      const badge = screen.getByTestId("grid-status-badge");
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveTextContent("Utility Mains Online");
    });
  });

  it("simulates status transition to OUTAGE and renders alert banner", async () => {
    render(<PowerGridReliabilityMonitor />);

    await waitFor(() => {
      expect(screen.getByTestId("simulate-outage-btn")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("simulate-outage-btn"));

    await waitFor(() => {
      const badge = screen.getByTestId("grid-status-badge");
      expect(badge).toHaveTextContent("Sudden Power Outage");
    });
  });

  it("simulates status transition to GENERATOR_ACTIVE", async () => {
    render(<PowerGridReliabilityMonitor />);

    await waitFor(() => {
      expect(screen.getByTestId("simulate-generator-btn")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("simulate-generator-btn"));

    await waitFor(() => {
      const badge = screen.getByTestId("grid-status-badge");
      expect(badge).toHaveTextContent("Backup Generator Active");
    });
  });

  it("toggles push alert subscription and updates localStorage", async () => {
    render(<PowerGridReliabilityMonitor venueId="venue-sf-01" />);

    const toggleBtn = await screen.findByTestId("power-outage-subscription-toggle");
    expect(toggleBtn).toHaveTextContent("Enable Outage Push Alerts");

    fireEvent.click(toggleBtn);

    await waitFor(() => {
      expect(toggleBtn).toHaveTextContent("Outage Alerts Subscribed");
      expect(localStorage.getItem("power_alerts_subscribed_venue-sf-01")).toBe("true");
    });

    fireEvent.click(toggleBtn);

    await waitFor(() => {
      expect(toggleBtn).toHaveTextContent("Enable Outage Push Alerts");
      expect(localStorage.getItem("power_alerts_subscribed_venue-sf-01")).toBe("false");
    });
  });

  it("refetches power grid telemetry when clicking Refresh Grid", async () => {
    render(<PowerGridReliabilityMonitor venueId="venue-sf-01" />);

    await screen.findByText("Desk A1");

    const refreshBtn = screen.getByRole("button", { name: /refresh grid/i });
    fireEvent.click(refreshBtn);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/telemetry/outlets?venueId=venue-sf-01")
      );
    });
  });

  it("opens report dead plug modal, submits report, and displays feedback", async () => {
    render(<PowerGridReliabilityMonitor />);

    await screen.findByText("Desk A1");

    const reportButtons = screen.getAllByRole("button", { name: /report issue/i });
    expect(reportButtons.length).toBeGreaterThan(0);

    fireEvent.click(reportButtons[0]);

    expect(screen.getByText(/report broken socket/i)).toBeInTheDocument();
    expect(screen.getAllByText("Desk A1").length).toBeGreaterThanOrEqual(2);

    const deadSocketOption = screen.getByRole("button", {
      name: /dead socket \(zero power \/ no charging\)/i,
    });
    fireEvent.click(deadSocketOption);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/telemetry/outlets",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            seatId: "seat-1",
            issueType: "DEAD_NO_POWER",
          }),
        })
      );
    });

    await waitFor(() => {
      expect(
        screen.getByText(/issue logged for desk a1\. facility ops notified!/i)
      ).toBeInTheDocument();
    });
  });

  it("closes reporting modal when clicking cancel button", async () => {
    render(<PowerGridReliabilityMonitor />);

    await screen.findByText("Desk A1");

    const reportButtons = screen.getAllByRole("button", { name: /report issue/i });
    fireEvent.click(reportButtons[0]);

    expect(screen.getByText(/report broken socket/i)).toBeInTheDocument();

    const cancelBtn = screen.getByRole("button", { name: /cancel/i });
    fireEvent.click(cancelBtn);

    expect(screen.queryByText(/report broken socket/i)).not.toBeInTheDocument();
  });

  it("applies custom className and custom data-testid", () => {
    render(
      <PowerGridReliabilityMonitor
        className="custom-power-class"
        data-testid="custom-power-monitor"
      />
    );

    const container = screen.getByTestId("custom-power-monitor");
    expect(container).toBeInTheDocument();
    expect(container).toHaveClass("custom-power-class");
  });
});

import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import PowerGridReliabilityMonitor from "@/components/venue/PowerGridReliabilityMonitor";
import {
  computeVenuePowerGridSummary,
  type DeskPowerNode,
  type PowerGridStatus,
} from "@/lib/telemetry/powerGridEngine";

// Mock usePushNotifications
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

describe("PowerGridReliabilityMonitor - Power Outage Push Notifications (#5307)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    global.fetch = jest.fn().mockImplementation((url: string) => {
      let status: PowerGridStatus = "ONLINE_MAINS";
      if (url.includes("gridStatus=OUTAGE")) status = "OUTAGE";
      if (url.includes("gridStatus=GENERATOR_ACTIVE")) status = "GENERATOR_ACTIVE";

      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            success: true,
            summary: computeVenuePowerGridSummary(
              "venue-sf-01",
              "Mission Focus Coworking & Cafe",
              [
                {
                  seatId: "seat-1",
                  seatNumber: "Desk 01",
                  socketType: "USB_C_140W_PD",
                  maxWattageW: 140,
                  measuredVoltageV: 120,
                  status: "OPERATIONAL_OPTIMAL",
                  reliabilityScorePct: 100,
                  lastVerifiedAt: new Date().toISOString(),
                  reportedIssueCount: 0,
                  outletLocation: "DESK_GROMMET",
                },
              ],
              120,
              status
            ),
          }),
      });
    }) as any;
  });

  describe("1. Engine Status Computations", () => {
    it("computes ONLINE_MAINS when all outlets are operational", () => {
      const nodes: DeskPowerNode[] = [
        {
          seatId: "s1",
          seatNumber: "D1",
          socketType: "USB_C_100W_PD",
          maxWattageW: 100,
          measuredVoltageV: 120,
          status: "OPERATIONAL_OPTIMAL",
          reliabilityScorePct: 95,
          lastVerifiedAt: "",
          reportedIssueCount: 0,
          outletLocation: "UNDER_DESK",
        },
      ];
      const summary = computeVenuePowerGridSummary("v1", "Venue 1", nodes);
      expect(summary.gridStatus).toBe("ONLINE_MAINS");
      expect(summary.generatorActive).toBe(false);
    });

    it("computes OUTAGE when all outlets have zero power", () => {
      const nodes: DeskPowerNode[] = [
        {
          seatId: "s1",
          seatNumber: "D1",
          socketType: "AC_UNIVERSAL_WALL",
          maxWattageW: 0,
          measuredVoltageV: 0,
          status: "DEAD_NO_POWER",
          reliabilityScorePct: 0,
          lastVerifiedAt: "",
          reportedIssueCount: 5,
          outletLocation: "WALL_MOUNTED",
        },
      ];
      const summary = computeVenuePowerGridSummary("v1", "Venue 1", nodes);
      expect(summary.gridStatus).toBe("OUTAGE");
      expect(summary.batteryBackupMinutesRemaining).toBe(45);
    });

    it("respects forcedStatus for GENERATOR_ACTIVE", () => {
      const summary = computeVenuePowerGridSummary("v1", "Venue 1", [], 120, "GENERATOR_ACTIVE");
      expect(summary.gridStatus).toBe("GENERATOR_ACTIVE");
      expect(summary.generatorActive).toBe(true);
      expect(summary.batteryBackupMinutesRemaining).toBe(180);
    });
  });

  describe("2. Push Notification Subscription Toggle", () => {
    it("renders push notification subscription button and toggles subscription state", async () => {
      render(<PowerGridReliabilityMonitor venueId="venue-sf-01" />);

      await waitFor(() => {
        expect(screen.getByTestId("power-outage-subscription-toggle")).toBeInTheDocument();
      });

      const toggleBtn = screen.getByTestId("power-outage-subscription-toggle");
      expect(toggleBtn).toHaveTextContent("Enable Outage Push Alerts");

      // Click to subscribe
      fireEvent.click(toggleBtn);

      await waitFor(() => {
        expect(toggleBtn).toHaveTextContent("Outage Alerts Subscribed");
        expect(localStorage.getItem("power_alerts_subscribed_venue-sf-01")).toBe("true");
      });

      // Click again to unsubscribe
      fireEvent.click(toggleBtn);

      await waitFor(() => {
        expect(toggleBtn).toHaveTextContent("Enable Outage Push Alerts");
        expect(localStorage.getItem("power_alerts_subscribed_venue-sf-01")).toBe("false");
      });
    });

    it("triggers alert banner when subscribed user experiences OUTAGE transition", async () => {
      render(<PowerGridReliabilityMonitor venueId="venue-sf-01" />);

      await waitFor(() => {
        expect(screen.getByTestId("power-outage-subscription-toggle")).toBeInTheDocument();
      });

      // Subscribe first
      const toggleBtn = screen.getByTestId("power-outage-subscription-toggle");
      fireEvent.click(toggleBtn);
      await waitFor(() => {
        expect(toggleBtn).toHaveTextContent("Outage Alerts Subscribed");
      });

      // Simulate power outage transition
      const outageBtn = screen.getByTestId("simulate-outage-btn");
      fireEvent.click(outageBtn);

      await waitFor(() => {
        const banner = screen.getByTestId("active-power-alert-banner");
        expect(banner).toBeInTheDocument();
        expect(banner).toHaveTextContent("Emergency Power Outage");
      });
    });

    it("triggers alert banner when subscribed user experiences GENERATOR_ACTIVE transition", async () => {
      render(<PowerGridReliabilityMonitor venueId="venue-sf-01" />);

      await waitFor(() => {
        expect(screen.getByTestId("power-outage-subscription-toggle")).toBeInTheDocument();
      });

      // Subscribe first
      const toggleBtn = screen.getByTestId("power-outage-subscription-toggle");
      fireEvent.click(toggleBtn);

      // Simulate generator switch
      const genBtn = screen.getByTestId("simulate-generator-btn");
      fireEvent.click(genBtn);

      await waitFor(() => {
        const banner = screen.getByTestId("active-power-alert-banner");
        expect(banner).toBeInTheDocument();
        expect(banner).toHaveTextContent("Emergency Generator Active");
      });
    });
  });
});

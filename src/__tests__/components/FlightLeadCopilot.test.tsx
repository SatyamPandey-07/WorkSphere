import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import {
  FlightLeadCopilot,
  evaluateRerouteTrigger,
  findOptimalEvasionTarget,
  generateTacticalEvasionPlan,
  calculateDistanceMeters,
  formatMilitaryBearing,
  type VenueTelemetry,
} from "@/components/ai/FlightLeadCopilot";

describe("FlightLeadCopilot Automated Airspace Rerouting Assistant (#6330)", () => {
  const currentVenueNomadBase: VenueTelemetry = {
    venueId: "base-alpha",
    venueName: "Base Alpha // Ferris Aircraft Hangar",
    coordinates: { lat: 37.7749, lng: -122.4194 },
    occupancyCount: 50,
    maxCapacity: 100,
    decibelLevel: 62,
    wifiLatencyMs: 25,
    comfortScore: 85,
  };

  const waypointEmerald: VenueTelemetry = {
    venueId: "wp-emerald",
    venueName: "Waypoint Emerald",
    coordinates: { lat: 37.7771, lng: -122.4165 }, // ~350m northeast, bearing approx 045°
    occupancyCount: 22,
    maxCapacity: 80,
    decibelLevel: 48,
    wifiLatencyMs: 18,
    comfortScore: 94,
  };

  const candidateVenues: VenueTelemetry[] = [
    waypointEmerald,
    {
      venueId: "wp-noisy-cafe",
      venueName: "Waypoint High-Traffic Espresso",
      coordinates: { lat: 37.7735, lng: -122.421 },
      occupancyCount: 75,
      maxCapacity: 80,
      decibelLevel: 78,
      wifiLatencyMs: 85,
      comfortScore: 50,
    },
    {
      venueId: "wp-far-nexus",
      venueName: "Waypoint Outer Ring",
      coordinates: { lat: 37.82, lng: -122.38 },
      occupancyCount: 15,
      maxCapacity: 100,
      decibelLevel: 45,
      wifiLatencyMs: 20,
      comfortScore: 90,
    },
  ];

  describe("Geographic & Tactical Utilities", () => {
    it("calculates great-circle distance accurately between venues", () => {
      const dist = calculateDistanceMeters(
        currentVenueNomadBase.coordinates.lat,
        currentVenueNomadBase.coordinates.lng,
        waypointEmerald.coordinates.lat,
        waypointEmerald.coordinates.lng,
      );
      expect(dist).toBeGreaterThan(300);
      expect(dist).toBeLessThan(450);
    });

    it("formats bearing in military 3-digit format", () => {
      expect(formatMilitaryBearing(45)).toBe("045°");
      expect(formatMilitaryBearing(5)).toBe("005°");
      expect(formatMilitaryBearing(180)).toBe("180°");
      expect(formatMilitaryBearing(359)).toBe("359°");
    });
  });

  describe("Automated Rerouting Decision Trees (evaluateRerouteTrigger)", () => {
    const thresholds = {
      noiseDb: 75,
      occupancyPercent: 85,
      latencyMs: 90,
    };

    it("does not trigger reroute under normal, comfortable conditions", () => {
      const evaluation = evaluateRerouteTrigger(currentVenueNomadBase, thresholds);
      expect(evaluation.shouldReroute).toBe(false);
      expect(evaluation.triggerType).toBeUndefined();
    });

    it("triggers noise_spike reroute when decibelLevel >= 75dB", () => {
      const noisyVenue: VenueTelemetry = {
        ...currentVenueNomadBase,
        decibelLevel: 78,
      };
      const evaluation = evaluateRerouteTrigger(noisyVenue, thresholds);
      expect(evaluation.shouldReroute).toBe(true);
      expect(evaluation.triggerType).toBe("noise_spike");
      expect(evaluation.reason).toContain("75dB");
    });

    it("triggers overcrowded reroute when occupancy >= 85%", () => {
      const crowdedVenue: VenueTelemetry = {
        ...currentVenueNomadBase,
        occupancyCount: 88,
        maxCapacity: 100, // 88%
      };
      const evaluation = evaluateRerouteTrigger(crowdedVenue, thresholds);
      expect(evaluation.shouldReroute).toBe(true);
      expect(evaluation.triggerType).toBe("overcrowded");
      expect(evaluation.reason).toContain("88%");
    });

    it("triggers wifi_degradation reroute when latency >= 90ms", () => {
      const laggyVenue: VenueTelemetry = {
        ...currentVenueNomadBase,
        wifiLatencyMs: 110,
      };
      const evaluation = evaluateRerouteTrigger(laggyVenue, thresholds);
      expect(evaluation.shouldReroute).toBe(true);
      expect(evaluation.triggerType).toBe("wifi_degradation");
      expect(evaluation.reason).toContain("110ms");
    });

    it("triggers compound_degradation with critical severity when multiple hazards occur", () => {
      const disasterVenue: VenueTelemetry = {
        ...currentVenueNomadBase,
        decibelLevel: 80,
        occupancyCount: 92,
        maxCapacity: 100,
        wifiLatencyMs: 140,
      };
      const evaluation = evaluateRerouteTrigger(disasterVenue, thresholds);
      expect(evaluation.shouldReroute).toBe(true);
      expect(evaluation.triggerType).toBe("compound_degradation");
      expect(evaluation.severity).toBe("critical");
    });
  });

  describe("Optimal Evasion Target Selection (findOptimalEvasionTarget)", () => {
    it("selects closest, quietest, high-comfort venue among candidates", () => {
      const optimal = findOptimalEvasionTarget(currentVenueNomadBase, candidateVenues);
      expect(optimal).not.toBeNull();
      expect(optimal?.venueId).toBe("wp-emerald");
    });

    it("returns null if no other eligible candidates exist", () => {
      const singleVenue = [currentVenueNomadBase];
      const optimal = findOptimalEvasionTarget(currentVenueNomadBase, singleVenue);
      expect(optimal).toBeNull();
    });
  });

  describe("Tactical Flight Plan Generation (generateTacticalEvasionPlan)", () => {
    it("generates proactive advisory formatted string with bearing and ETA", () => {
      const plan = generateTacticalEvasionPlan(
        { ...currentVenueNomadBase, decibelLevel: 78 },
        waypointEmerald,
        "noise_spike",
        "Current sector noise exceeding 75dB",
        "warning",
      );

      expect(plan.copilotAdvisory).toContain("Flight Lead Advisory:");
      expect(plan.copilotAdvisory).toContain("Current sector noise exceeding 75dB");
      expect(plan.copilotAdvisory).toContain("Waypoint Emerald");
      expect(plan.copilotAdvisory).toMatch(/bearing \d{3}°/);
      expect(plan.noiseDeltaDb).toBeLessThan(0); // Quieter target
      expect(plan.etaMinutes).toBeGreaterThan(0);
    });
  });

  describe("FlightLeadCopilot UI Component Rendering & Interactions", () => {
    it("renders live sector telemetry strip with noise, occupancy, and latency", () => {
      render(
        <FlightLeadCopilot
          currentVenue={currentVenueNomadBase}
          candidateVenues={candidateVenues}
        />,
      );

      expect(screen.getByTestId("flight-lead-copilot")).toBeInTheDocument();
      expect(screen.getByText(/Base Alpha \/\/ Ferris Aircraft Hangar/i)).toBeInTheDocument();
      expect(screen.getByTestId("telemetry-noise")).toHaveTextContent("62 dB");
      expect(screen.getByTestId("telemetry-occupancy")).toHaveTextContent("50%");
      expect(screen.getByTestId("telemetry-latency")).toHaveTextContent("25 ms");
      expect(screen.queryByTestId("tactical-evasion-modal")).not.toBeInTheDocument();
    });

    it("automatically opens Tactical Evasion Flight Plan modal when noise threshold is exceeded", () => {
      const noisyVenue: VenueTelemetry = {
        ...currentVenueNomadBase,
        decibelLevel: 79,
      };

      render(
        <FlightLeadCopilot
          currentVenue={noisyVenue}
          candidateVenues={candidateVenues}
          noiseThresholdDb={75}
        />,
      );

      expect(screen.getByTestId("tactical-evasion-modal")).toBeInTheDocument();
      expect(screen.getByText(/TACTICAL EVASION FLIGHT PLAN/i)).toBeInTheDocument();
      expect(screen.getByTestId("copilot-advisory-banner")).toHaveTextContent(
        /Current sector noise exceeding 75dB/i,
      );
      expect(screen.getByTestId("metric-eta")).toBeInTheDocument();
      expect(screen.getByTestId("metric-noise-delta")).toBeInTheDocument();
      expect(screen.getByTestId("metric-bearing")).toBeInTheDocument();
    });

    it("handles accepting the evasion reroute and calls onAcceptReroute", () => {
      jest.useFakeTimers();
      const handleAccept = jest.fn();
      const noisyVenue: VenueTelemetry = {
        ...currentVenueNomadBase,
        decibelLevel: 82,
      };

      render(
        <FlightLeadCopilot
          currentVenue={noisyVenue}
          candidateVenues={candidateVenues}
          onAcceptReroute={handleAccept}
        />,
      );

      const acceptBtn = screen.getByTestId("accept-reroute-button");
      fireEvent.click(acceptBtn);

      expect(handleAccept).toHaveBeenCalledWith(
        expect.objectContaining({
          triggerType: "noise_spike",
          targetVenue: expect.objectContaining({ venueId: "wp-emerald" }),
        }),
      );

      act(() => {
        jest.advanceTimersByTime(1500);
      });

      expect(screen.queryByTestId("tactical-evasion-modal")).not.toBeInTheDocument();
      jest.useRealTimers();
    });

    it("handles dismissing the advisory with Hold Position and dismiss button", () => {
      const handleDismiss = jest.fn();
      const crowdedVenue: VenueTelemetry = {
        ...currentVenueNomadBase,
        occupancyCount: 90,
        maxCapacity: 100,
      };

      render(
        <FlightLeadCopilot
          currentVenue={crowdedVenue}
          candidateVenues={candidateVenues}
          onDismissAdvisory={handleDismiss}
        />,
      );

      const dismissBtn = screen.getByTestId("dismiss-evasion-button");
      fireEvent.click(dismissBtn);

      expect(handleDismiss).toHaveBeenCalled();
      expect(screen.queryByTestId("tactical-evasion-modal")).not.toBeInTheDocument();
    });
  });
});

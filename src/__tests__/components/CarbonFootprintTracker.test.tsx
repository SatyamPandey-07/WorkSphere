import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import CarbonFootprintTracker from "@/components/analytics/CarbonFootprintTracker";
import type { CarbonFootprintSummary } from "@/lib/sustainability/carbonEngine";

describe("CarbonFootprintTracker - Missing Commute Distance Handling", () => {
  const createMockSummary = (
    overrides: Partial<CarbonFootprintSummary> = {}
  ): CarbonFootprintSummary => ({
    periodMonth: "October 2026",
    totalDistanceKm: 25.4,
    totalEmissionsKgCo2: 1.82,
    totalAvoidedKgCo2: 2.55,
    treesEquivalentOffset: 1.4,
    greenVenuesVisitedCount: 3,
    modeBreakdown: [
      {
        mode: "PUBLIC_TRANSIT",
        label: "PUBLIC TRANSIT",
        distanceKm: 25.4,
        emissionsKgCo2: 1.82,
        percentage: 100,
      },
    ],
    ecoBadgesEarned: [],
    records: [
      {
        bookingId: "BK-001",
        venueName: "Eco Hub",
        date: "2026-10-01",
        distanceKm: 25.4,
        commuteMode: "PUBLIC_TRANSIT",
        emissionsGramsCo2: 1820,
        avoidedGramsCo2: 2550,
        isGreenCertifiedVenue: true,
      },
    ],
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders gentle prompt when total commute distance is zero", async () => {
    const zeroDistanceSummary = createMockSummary({
      totalDistanceKm: 0,
      records: [
        {
          bookingId: "BK-002",
          venueName: "WeWork Downtown",
          date: "2026-10-02",
          distanceKm: 0,
          commuteMode: "WALKING",
          emissionsGramsCo2: 0,
          avoidedGramsCo2: 0,
          isGreenCertifiedVenue: false,
        },
      ],
    });

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, summary: zeroDistanceSummary }),
    } as Response);

    render(<CarbonFootprintTracker />);

    await waitFor(() => {
      expect(
        screen.getByTestId("missing-commute-distance-prompt")
      ).toBeInTheDocument();
    });

    expect(
      screen.getByText("No home location or commute distance recorded")
    ).toBeInTheDocument();
  });

  it("renders partial missing commute distance prompt when some records lack distance", async () => {
    const partialSummary = createMockSummary({
      totalDistanceKm: 15.0,
      records: [
        {
          bookingId: "BK-003",
          venueName: "Sightglass",
          date: "2026-10-03",
          distanceKm: 15.0,
          commuteMode: "BICYCLING",
          emissionsGramsCo2: 0,
          avoidedGramsCo2: 2580,
          isGreenCertifiedVenue: true,
        },
        {
          bookingId: "BK-004",
          venueName: "Workshop Cafe",
          date: "2026-10-04",
          distanceKm: 0,
          commuteMode: "PUBLIC_TRANSIT",
          emissionsGramsCo2: 0,
          avoidedGramsCo2: 0,
          isGreenCertifiedVenue: false,
        },
      ],
    });

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, summary: partialSummary }),
    } as Response);

    render(<CarbonFootprintTracker />);

    await waitFor(() => {
      expect(
        screen.getByTestId("partial-missing-commute-distance-prompt")
      ).toBeInTheDocument();
    });

    expect(
      screen.getByText(/1 commute record has uncalculated distance/i)
    ).toBeInTheDocument();
  });

  it("does not render missing distance prompts when all records have valid distance", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, summary: createMockSummary() }),
    } as Response);

    render(<CarbonFootprintTracker />);

    await waitFor(() => {
      expect(
        screen.queryByTestId("missing-commute-distance-prompt")
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("partial-missing-commute-distance-prompt")
      ).not.toBeInTheDocument();
    });
  });

  it("displays error banner and retry option when API fetch fails", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ success: false, error: "Database offline" }),
    } as Response);

    render(<CarbonFootprintTracker />);

    await waitFor(() => {
      expect(screen.getByTestId("carbon-fetch-error")).toBeInTheDocument();
    });

    expect(
      screen.queryByTestId("missing-commute-distance-prompt")
    ).not.toBeInTheDocument();
  });
});

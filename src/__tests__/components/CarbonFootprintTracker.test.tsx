import React from "react";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
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

describe("CarbonFootprintTracker - Team Carbon Savings Leaderboard & Ranking Podium (#5309)", () => {
  const createMockSummaryWithTeams = (): CarbonFootprintSummary => ({
    periodMonth: "October 2026",
    totalDistanceKm: 120.0,
    totalEmissionsKgCo2: 8.5,
    totalAvoidedKgCo2: 45.2,
    treesEquivalentOffset: 25.0,
    greenVenuesVisitedCount: 8,
    modeBreakdown: [
      {
        mode: "PUBLIC_TRANSIT",
        label: "PUBLIC TRANSIT",
        distanceKm: 80.0,
        emissionsKgCo2: 2.8,
        percentage: 67,
      },
      {
        mode: "BICYCLING",
        label: "BICYCLING",
        distanceKm: 40.0,
        emissionsKgCo2: 0,
        percentage: 33,
      },
    ],
    ecoBadgesEarned: [],
    records: [
      {
        bookingId: "BK-101",
        venueName: "Berlin Mitte Eco-Hub",
        date: "2026-10-01",
        distanceKm: 25.0,
        commuteMode: "PUBLIC_TRANSIT",
        emissionsGramsCo2: 875,
        avoidedGramsCo2: 3425,
        isGreenCertifiedVenue: true,
      },
    ],
    teamLeaderboard: [
      {
        teamId: "team-frontend",
        teamName: "Frontend & Mobile Engineering",
        department: "Product Engineering",
        membersCount: 18,
        regionalHub: "Berlin Mitte Eco-Hub",
        monthlyAvoidedKgCo2: 1920.4,
        transitEmissionsSavedKg: 520.4,
        flightEmissionsAvoidedKg: 1400.0,
        treesEquivalent: 105.8,
        hubUtilizationRate: 94,
        badgeTier: "EMERALD",
        rank: 1,
      },
      {
        teamId: "team-cloud",
        teamName: "Cloud Infrastructure & SRE",
        department: "Systems & Security",
        membersCount: 14,
        regionalHub: "Tokyo Shibuya Green Hub",
        monthlyAvoidedKgCo2: 1460.2,
        transitEmissionsSavedKg: 410.2,
        flightEmissionsAvoidedKg: 1050.0,
        treesEquivalent: 80.5,
        hubUtilizationRate: 89,
        badgeTier: "GOLD",
        rank: 2,
      },
      {
        teamId: "team-design",
        teamName: "Product & UX Design Guild",
        department: "Design & Research",
        membersCount: 12,
        regionalHub: "London Shoreditch Workspace",
        monthlyAvoidedKgCo2: 1220.8,
        transitEmissionsSavedKg: 345.8,
        flightEmissionsAvoidedKg: 875.0,
        treesEquivalent: 67.3,
        hubUtilizationRate: 86,
        badgeTier: "SILVER",
        rank: 3,
      },
    ],
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders team carbon savings leaderboard and podium container", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, summary: createMockSummaryWithTeams() }),
    } as Response);

    render(<CarbonFootprintTracker />);

    await waitFor(() => {
      expect(
        screen.getByTestId("team-carbon-leaderboard")
      ).toBeInTheDocument();
      expect(
        screen.getByTestId("carbon-ranking-podium")
      ).toBeInTheDocument();
    });

    expect(
      screen.getByText("Team & Organization Carbon Savings Leaderboard")
    ).toBeInTheDocument();
  });

  it("renders all 3 visual ranking podium positions with team names and regional hubs", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, summary: createMockSummaryWithTeams() }),
    } as Response);

    render(<CarbonFootprintTracker />);

    await waitFor(() => {
      expect(screen.getByTestId("podium-rank-1")).toBeInTheDocument();
      expect(screen.getByTestId("podium-rank-2")).toBeInTheDocument();
      expect(screen.getByTestId("podium-rank-3")).toBeInTheDocument();
    });

    const podiumRank1 = screen.getByTestId("podium-rank-1");
    const podiumRank2 = screen.getByTestId("podium-rank-2");
    const podiumRank3 = screen.getByTestId("podium-rank-3");

    // 1st place
    expect(within(podiumRank1).getByText("Frontend & Mobile Engineering")).toBeInTheDocument();
    expect(within(podiumRank1).getByText("Berlin Mitte Eco-Hub")).toBeInTheDocument();
    expect(within(podiumRank1).getByText("1920.4")).toBeInTheDocument();

    // 2nd place
    expect(within(podiumRank2).getByText("Cloud Infrastructure & SRE")).toBeInTheDocument();
    expect(within(podiumRank2).getByText("Tokyo Shibuya Green Hub")).toBeInTheDocument();

    // 3rd place
    expect(within(podiumRank3).getByText("Product & UX Design Guild")).toBeInTheDocument();
    expect(within(podiumRank3).getByText("London Shoreditch Workspace")).toBeInTheDocument();
  });

  it("renders exportable team badge preview and allows selecting different teams", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, summary: createMockSummaryWithTeams() }),
    } as Response);

    render(<CarbonFootprintTracker />);

    await waitFor(() => {
      expect(screen.getByTestId("team-badge-preview")).toBeInTheDocument();
    });

    // Default selected team is Rank 1
    expect(
      screen.getByText(/Rank #1 • EMERALD Badge/i)
    ).toBeInTheDocument();

    // Click 2nd place podium card
    const rank2Card = screen.getByTestId("podium-rank-2");
    fireEvent.click(rank2Card);

    // Badge preview updates to Rank 2
    expect(
      screen.getByText(/Rank #2 • GOLD Badge/i)
    ).toBeInTheDocument();
  });

  it("triggers SVG badge download when Export Team Sustainability Badge is clicked", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, summary: createMockSummaryWithTeams() }),
    } as Response);

    // Mock URL.createObjectURL and revokeObjectURL
    const mockCreateObjectURL = jest.fn().mockReturnValue("blob:mock-badge-url");
    const mockRevokeObjectURL = jest.fn();
    window.URL.createObjectURL = mockCreateObjectURL;
    window.URL.revokeObjectURL = mockRevokeObjectURL;

    render(<CarbonFootprintTracker />);

    await waitFor(() => {
      expect(screen.getByTestId("export-team-badge-btn")).toBeInTheDocument();
    });

    const exportBtn = screen.getByTestId("export-team-badge-btn");
    fireEvent.click(exportBtn);

    expect(mockCreateObjectURL).toHaveBeenCalled();
    expect(mockRevokeObjectURL).toHaveBeenCalledWith("blob:mock-badge-url");
  });
});


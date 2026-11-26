import React from "react";
import {
  act,
  render,
  screen,
  waitFor,
  fireEvent,
  within,
} from "@testing-library/react";
import "@testing-library/jest-dom";
import CarbonFootprintTracker, {
  formatLocalIsoDate,
  getCarbonDatePresetRange,
} from "@/components/analytics/CarbonFootprintTracker";
import type { CarbonFootprintSummary } from "@/lib/sustainability/carbonEngine";

describe("CarbonFootprintTracker - Missing Commute Distance Handling", () => {
  const createMockSummary = (
    overrides: Partial<CarbonFootprintSummary> = {},
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
        screen.getByTestId("missing-commute-distance-prompt"),
      ).toBeInTheDocument();
    });

    expect(
      screen.getByText("No home location or commute distance recorded"),
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
        screen.getByTestId("partial-missing-commute-distance-prompt"),
      ).toBeInTheDocument();
    });

    expect(
      screen.getByText(/1 commute record has uncalculated distance/i),
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
        screen.queryByTestId("missing-commute-distance-prompt"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("partial-missing-commute-distance-prompt"),
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
      screen.queryByTestId("missing-commute-distance-prompt"),
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
      json: async () => ({
        success: true,
        summary: createMockSummaryWithTeams(),
      }),
    } as Response);

    render(<CarbonFootprintTracker />);

    await waitFor(() => {
      expect(screen.getByTestId("team-carbon-leaderboard")).toBeInTheDocument();
      expect(screen.getByTestId("carbon-ranking-podium")).toBeInTheDocument();
    });

    expect(
      screen.getByText("Team & Organization Carbon Savings Leaderboard"),
    ).toBeInTheDocument();
  });

  it("renders all 3 visual ranking podium positions with team names and regional hubs", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        summary: createMockSummaryWithTeams(),
      }),
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
    expect(
      within(podiumRank1).getByText("Frontend & Mobile Engineering"),
    ).toBeInTheDocument();
    expect(
      within(podiumRank1).getByText("Berlin Mitte Eco-Hub"),
    ).toBeInTheDocument();
    expect(within(podiumRank1).getByText("1920.4")).toBeInTheDocument();

    // 2nd place
    expect(
      within(podiumRank2).getByText("Cloud Infrastructure & SRE"),
    ).toBeInTheDocument();
    expect(
      within(podiumRank2).getByText("Tokyo Shibuya Green Hub"),
    ).toBeInTheDocument();

    // 3rd place
    expect(
      within(podiumRank3).getByText("Product & UX Design Guild"),
    ).toBeInTheDocument();
    expect(
      within(podiumRank3).getByText("London Shoreditch Workspace"),
    ).toBeInTheDocument();
  });

  it("renders exportable team badge preview and allows selecting different teams", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        summary: createMockSummaryWithTeams(),
      }),
    } as Response);

    render(<CarbonFootprintTracker />);

    await waitFor(() => {
      expect(screen.getByTestId("team-badge-preview")).toBeInTheDocument();
    });

    // Default selected team is Rank 1
    expect(screen.getByText(/Rank #1 • EMERALD Badge/i)).toBeInTheDocument();

    // Click 2nd place podium card
    const rank2Card = screen.getByTestId("podium-rank-2");
    fireEvent.click(rank2Card);

    // Badge preview updates to Rank 2
    expect(screen.getByText(/Rank #2 • GOLD Badge/i)).toBeInTheDocument();
  });

  it("triggers SVG badge download when Export Team Sustainability Badge is clicked", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        summary: createMockSummaryWithTeams(),
      }),
    } as Response);

    // Mock URL.createObjectURL and revokeObjectURL
    const mockCreateObjectURL = jest
      .fn()
      .mockReturnValue("blob:mock-badge-url");
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

describe("CarbonFootprintTracker date range presets", () => {
  const summary = {
    periodMonth: "November 2026",
    totalDistanceKm: 10,
    totalEmissionsKgCo2: 1,
    totalAvoidedKgCo2: 2,
    treesEquivalentOffset: 1,
    greenVenuesVisitedCount: 1,
    modeBreakdown: [],
    ecoBadgesEarned: [],
    records: [],
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("renders all four preset buttons", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, summary }),
    } as Response);

    render(<CarbonFootprintTracker />);

    expect(screen.getByRole("button", { name: "7 Days" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "30 Days" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "This Month" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Year to Date" }),
    ).toBeInTheDocument();
  });

  it("calculates 7 Days as yesterday-to-seven-days-ago", () => {
    const now = new Date(2026, 10, 21, 12, 0, 0);
    expect(getCarbonDatePresetRange("7-days", now)).toEqual({
      startDate: "2026-11-14",
      endDate: "2026-11-20",
    });
  });

  it("calculates 30 Days including today", () => {
    const now = new Date(2026, 10, 21, 12, 0, 0);
    expect(getCarbonDatePresetRange("30-days", now)).toEqual({
      startDate: "2026-10-23",
      endDate: "2026-11-21",
    });
  });

  it("calculates This Month from the first local calendar day", () => {
    const now = new Date(2026, 10, 21, 12, 0, 0);
    expect(getCarbonDatePresetRange("this-month", now)).toEqual({
      startDate: "2026-11-01",
      endDate: "2026-11-21",
    });
  });

  it("calculates YTD from January 1", () => {
    const now = new Date(2026, 11, 31, 12, 0, 0);
    expect(getCarbonDatePresetRange("ytd", now)).toEqual({
      startDate: "2026-01-01",
      endDate: "2026-12-31",
    });
  });

  it("handles month boundaries for 7 Days", () => {
    expect(
      getCarbonDatePresetRange("7-days", new Date(2026, 0, 3, 12)),
    ).toEqual({
      startDate: "2025-12-27",
      endDate: "2026-01-02",
    });
  });

  it("handles December to January transitions for YTD", () => {
    expect(getCarbonDatePresetRange("ytd", new Date(2027, 11, 15, 12))).toEqual(
      {
        startDate: "2027-01-01",
        endDate: "2027-12-15",
      },
    );
  });

  it("handles March 1 in a leap year", () => {
    expect(
      getCarbonDatePresetRange("7-days", new Date(2024, 2, 1, 12)),
    ).toEqual({
      startDate: "2024-02-23",
      endDate: "2024-02-29",
    });
  });

  it("updates date inputs and highlights only the selected preset", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 10, 21, 12, 0, 0));
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, summary }),
    } as Response);

    render(<CarbonFootprintTracker />);

    const thirtyDays = screen.getByRole("button", { name: "30 Days" });
    fireEvent.click(thirtyDays);

    expect(screen.getByLabelText("Start date")).toHaveValue("2026-10-23");
    expect(screen.getByLabelText("End date")).toHaveValue("2026-11-21");
    expect(thirtyDays).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "7 Days" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    await act(async () => {});
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/analytics/carbon-footprint?startDate=2026-10-23&endDate=2026-11-21",
    );
  });

  it("clears preset selection when the start date is changed manually", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 10, 21, 12, 0, 0));
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, summary }),
    } as Response);

    render(<CarbonFootprintTracker />);

    fireEvent.click(screen.getByRole("button", { name: "This Month" }));
    fireEvent.change(screen.getByLabelText("Start date"), {
      target: { value: "2026-11-10" },
    });

    expect(screen.getByRole("button", { name: "This Month" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByLabelText("Start date")).toHaveValue("2026-11-10");
  });

  it("clears preset selection when the end date is changed manually", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 10, 21, 12, 0, 0));
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, summary }),
    } as Response);

    render(<CarbonFootprintTracker />);

    fireEvent.click(screen.getByRole("button", { name: "Year to Date" }));
    fireEvent.change(screen.getByLabelText("End date"), {
      target: { value: "2026-10-31" },
    });

    expect(
      screen.getByRole("button", { name: "Year to Date" }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByLabelText("End date")).toHaveValue("2026-10-31");
  });

  it("formats local dates without UTC shifts", () => {
    expect(formatLocalIsoDate(new Date(2026, 0, 1, 23, 59))).toBe("2026-01-01");
  });
});

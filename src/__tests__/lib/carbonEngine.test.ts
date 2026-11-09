import {
  safeParseDistance,
  calculateCommuteEmissions,
  generateMonthlyCarbonSummary,
  exportCorporateESGReportCSV,
  aggregateTeamCarbonSavings,
  generateTeamBadgeSVG,
} from "@/lib/sustainability/carbonEngine";

describe("carbonEngine - Null & Undefined Commute Distance Safeguards", () => {
  it("safeParseDistance returns 0 for null, undefined, NaN, or non-number inputs", () => {
    expect(safeParseDistance(null)).toBe(0);
    expect(safeParseDistance(undefined)).toBe(0);
    expect(safeParseDistance(NaN)).toBe(0);
    expect(safeParseDistance(-15)).toBe(0);
    expect(safeParseDistance(12.5)).toBe(12.5);
  });

  it("calculateCommuteEmissions handles null or undefined distanceKm gracefully", () => {
    const resNull = calculateCommuteEmissions(null, "WALKING");
    expect(resNull.emissionsGrams).toBe(0);
    expect(resNull.avoidedGrams).toBe(0);

    const resUndefined = calculateCommuteEmissions(undefined, "GASOLINE_CAR");
    expect(resUndefined.emissionsGrams).toBe(0);
    expect(resUndefined.avoidedGrams).toBe(0);

    const resValid = calculateCommuteEmissions(10, "WALKING");
    expect(resValid.emissionsGrams).toBe(0);
    expect(resValid.avoidedGrams).toBe(1720); // 10km * 172g baseline
  });

  it("generateMonthlyCarbonSummary handles records with missing or null distanceKm", () => {
    const records = [
      {
        bookingId: "b-1",
        venueName: "Venue A",
        date: "2026-10-01",
        distanceKm: null,
        commuteMode: "WALKING" as const,
      },
      {
        bookingId: "b-2",
        venueName: "Venue B",
        date: "2026-10-02",
        distanceKm: undefined,
        commuteMode: "PUBLIC_TRANSIT" as const,
      },
      {
        bookingId: "b-3",
        venueName: "Venue C",
        date: "2026-10-03",
        distanceKm: 5.0,
        commuteMode: "BICYCLING" as const,
      },
    ];

    const summary = generateMonthlyCarbonSummary(records, "October 2026");

    expect(summary.totalDistanceKm).toBe(5.0);
    expect(summary.records[0].distanceKm).toBe(0);
    expect(summary.records[1].distanceKm).toBe(0);
    expect(summary.records[2].distanceKm).toBe(5.0);

    const csv = exportCorporateESGReportCSV(summary);
    expect(csv).toContain("0.0");
    expect(csv).toContain("5.0");
  });
});

describe("carbonEngine - Team Carbon Savings & Leaderboard Aggregation (#5309)", () => {
  it("aggregates monthly CO2e savings per team organization and ranks them descending", () => {
    const customTeams = [
      {
        teamId: "team-a",
        teamName: "Core Platform",
        regionalHub: "Tokyo Eco-Hub",
        transitEmissionsSavedKg: 200,
        flightEmissionsAvoidedKg: 800,
      },
      {
        teamId: "team-b",
        teamName: "Design Guild",
        regionalHub: "Berlin Mitte",
        transitEmissionsSavedKg: 300,
        flightEmissionsAvoidedKg: 1200,
      },
      {
        teamId: "team-c",
        teamName: "Data Systems",
        regionalHub: "London Shoreditch",
        transitEmissionsSavedKg: 150,
        flightEmissionsAvoidedKg: 500,
      },
    ];

    const ranked = aggregateTeamCarbonSavings(customTeams);

    expect(ranked).toHaveLength(3);
    // Team B has 1500 kg avoided CO2 -> Rank 1
    expect(ranked[0].teamId).toBe("team-b");
    expect(ranked[0].rank).toBe(1);
    expect(ranked[0].badgeTier).toBe("EMERALD");
    expect(ranked[0].monthlyAvoidedKgCo2).toBe(1500);

    // Team A has 1000 kg avoided CO2 -> Rank 2
    expect(ranked[1].teamId).toBe("team-a");
    expect(ranked[1].rank).toBe(2);
    expect(ranked[1].badgeTier).toBe("GOLD");
    expect(ranked[1].monthlyAvoidedKgCo2).toBe(1000);

    // Team C has 650 kg avoided CO2 -> Rank 3
    expect(ranked[2].teamId).toBe("team-c");
    expect(ranked[2].rank).toBe(3);
    expect(ranked[2].badgeTier).toBe("SILVER");
    expect(ranked[2].monthlyAvoidedKgCo2).toBe(650);
  });

  it("calculates tree offset equivalencies correctly for team savings", () => {
    const teams = [
      {
        teamId: "team-x",
        teamName: "Sustainability Ops",
        transitEmissionsSavedKg: 500,
        flightEmissionsAvoidedKg: 500,
        monthlyAvoidedKgCo2: 1000,
      },
    ];

    const ranked = aggregateTeamCarbonSavings(teams);
    expect(ranked[0].treesEquivalent).toBeGreaterThan(0);
  });

  it("generateTeamBadgeSVG outputs valid XML/SVG with team metrics and ESG certification", () => {
    const team = {
      teamId: "team-frontend",
      teamName: "Frontend & Mobile",
      department: "Engineering",
      membersCount: 16,
      regionalHub: "Berlin Mitte Eco-Hub",
      monthlyAvoidedKgCo2: 1920.4,
      transitEmissionsSavedKg: 520.4,
      flightEmissionsAvoidedKg: 1400.0,
      treesEquivalent: 105.8,
      hubUtilizationRate: 94,
      badgeTier: "EMERALD" as const,
      rank: 1,
    };

    const svg = generateTeamBadgeSVG(team, "October 2026");

    expect(svg).toContain("<svg");
    expect(svg).toContain("Frontend &amp; Mobile");
    expect(svg).toContain("Berlin Mitte Eco-Hub");
    expect(svg).toContain("1920.4 kg");
    expect(svg).toContain("105.8 Trees");
    expect(svg).toContain("#1");
    expect(svg).toContain("WorkSphere Scope 3 Corporate ESG Verified");
    expect(svg).toContain("</svg>");
  });

  it("generateMonthlyCarbonSummary includes teamLeaderboard in output", () => {
    const summary = generateMonthlyCarbonSummary([], "November 2026");
    expect(summary.teamLeaderboard).toBeDefined();
    expect(summary.teamLeaderboard!.length).toBeGreaterThanOrEqual(3);
    expect(summary.teamLeaderboard![0].rank).toBe(1);
  });
});


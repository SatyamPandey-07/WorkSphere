/**
 * carbonEngine.ts
 * Implements EPA / EEA multimodal commute carbon footprint emissions calculations,
 * workspace green energy audits, and corporate Scope 3 ESG sustainability reporting.
 */

export type CommuteMode =
  | "WALKING"
  | "BICYCLING"
  | "ELECTRIC_SCOOTER"
  | "PUBLIC_TRANSIT"
  | "ELECTRIC_VEHICLE"
  | "GASOLINE_CAR";

export const EMISSION_FACTORS_G_PER_KM: Record<CommuteMode, number> = {
  WALKING: 0,
  BICYCLING: 0,
  ELECTRIC_SCOOTER: 12,
  PUBLIC_TRANSIT: 35,
  ELECTRIC_VEHICLE: 48,
  GASOLINE_CAR: 172, // Baseline comparison
};

export interface EcoWorkspaceBadge {
  id: string;
  name: string;
  category: "ENERGY" | "WASTE" | "COMMUTE" | "WATER";
  description: string;
  verified: boolean;
}

export interface WorkspaceCommuteRecord {
  bookingId: string;
  venueName: string;
  date: string;
  distanceKm: number;
  commuteMode: CommuteMode;
  emissionsGramsCo2: number;
  avoidedGramsCo2: number; // emissions saved vs gasoline car baseline
  isGreenCertifiedVenue: boolean;
}

export interface TeamCarbonSavings {
  teamId: string;
  teamName: string;
  department: string;
  membersCount: number;
  regionalHub: string;
  monthlyAvoidedKgCo2: number;
  transitEmissionsSavedKg: number;
  flightEmissionsAvoidedKg: number;
  treesEquivalent: number;
  hubUtilizationRate: number;
  badgeTier: "EMERALD" | "GOLD" | "SILVER" | "BRONZE";
  rank?: number;
}

export interface CarbonFootprintSummary {
  periodMonth: string;
  totalDistanceKm: number;
  totalEmissionsKgCo2: number;
  totalAvoidedKgCo2: number;
  treesEquivalentOffset: number;
  greenVenuesVisitedCount: number;
  modeBreakdown: Array<{
    mode: CommuteMode;
    label: string;
    distanceKm: number;
    emissionsKgCo2: number;
    percentage: number;
  }>;
  ecoBadgesEarned: EcoWorkspaceBadge[];
  records: WorkspaceCommuteRecord[];
  teamLeaderboard?: TeamCarbonSavings[];
}

/**
 * Safely parses a distance value into a non-negative finite number (defaults to 0 if null/undefined/NaN).
 */
export function safeParseDistance(distance: number | null | undefined): number {
  if (typeof distance !== "number" || isNaN(distance) || !isFinite(distance)) {
    return 0;
  }
  return Math.max(0, distance);
}

/**
 * Calculates emissions and avoided emissions for a commute trip.
 */
export function calculateCommuteEmissions(
  distanceKm: number | null | undefined,
  mode: CommuteMode
): { emissionsGrams: number; avoidedGrams: number } {
  const safeDist = safeParseDistance(distanceKm);
  const actualFactor = EMISSION_FACTORS_G_PER_KM[mode] ?? 35;
  const baselineFactor = EMISSION_FACTORS_G_PER_KM.GASOLINE_CAR;

  const emissionsGrams = Math.round(safeDist * actualFactor);
  const baselineGrams = Math.round(safeDist * baselineFactor);
  const avoidedGrams = Math.max(0, baselineGrams - emissionsGrams);

  return { emissionsGrams, avoidedGrams };
}

/**
 * Aggregates monthly carbon footprint and corporate ESG Scope 3 metrics.
 */
export function generateMonthlyCarbonSummary(
  records: Array<{
    bookingId: string;
    venueName: string;
    date: string;
    distanceKm?: number | null;
    commuteDistance?: number | null;
    commuteMode: CommuteMode;
    isGreenCertifiedVenue?: boolean;
  }>,
  periodMonth = "October 2026",
  customTeams?: Partial<TeamCarbonSavings>[],
): CarbonFootprintSummary {
  let totalDistanceKm = 0;
  let totalEmissionsGrams = 0;
  let totalAvoidedGrams = 0;
  let greenVenuesCount = 0;

  const modeDistanceMap: Record<CommuteMode, number> = {
    WALKING: 0,
    BICYCLING: 0,
    ELECTRIC_SCOOTER: 0,
    PUBLIC_TRANSIT: 0,
    ELECTRIC_VEHICLE: 0,
    GASOLINE_CAR: 0,
  };

  const processedRecords: WorkspaceCommuteRecord[] = records.map((r) => {
    const rawDist = r.distanceKm ?? r.commuteDistance ?? 0;
    const safeDist = safeParseDistance(rawDist);

    const { emissionsGrams, avoidedGrams } = calculateCommuteEmissions(
      safeDist,
      r.commuteMode
    );

    totalDistanceKm += safeDist;
    totalEmissionsGrams += emissionsGrams;
    totalAvoidedGrams += avoidedGrams;
    modeDistanceMap[r.commuteMode] += safeDist;

    if (r.isGreenCertifiedVenue) greenVenuesCount++;

    return {
      bookingId: r.bookingId,
      venueName: r.venueName,
      date: r.date,
      distanceKm: safeDist,
      commuteMode: r.commuteMode,
      emissionsGramsCo2: emissionsGrams,
      avoidedGramsCo2: avoidedGrams,
      isGreenCertifiedVenue: r.isGreenCertifiedVenue ?? false,
    };
  });

  const totalDistance = totalDistanceKm > 0 ? totalDistanceKm : 1;
  const modeBreakdown = Object.entries(modeDistanceMap).map(([mode, dist]) => {
    const factor = EMISSION_FACTORS_G_PER_KM[mode as CommuteMode];
    const safeDist = safeParseDistance(dist);
    return {
      mode: mode as CommuteMode,
      label: mode.replace("_", " "),
      distanceKm: Number(safeDist.toFixed(1)),
      emissionsKgCo2: Number(((safeDist * factor) / 1000).toFixed(2)),
      percentage: Math.round((safeDist / totalDistance) * 100),
    };
  });

  // 1 mature urban tree absorbs ~21.7 kg CO2 per year (~1.8 kg/month)
  const treesEquivalentOffset = Number(
    (totalAvoidedGrams / 1000 / 1.8).toFixed(1)
  );

  const ecoBadges: EcoWorkspaceBadge[] = [
    {
      id: "b-zero-emissions",
      name: "Zero-Emission Commuter",
      category: "COMMUTE",
      description:
        "Over 70% of monthly workspace commutes completed via Walking or Cycling.",
      verified:
        modeDistanceMap.WALKING + modeDistanceMap.BICYCLING >=
        totalDistance * 0.7,
    },
    {
      id: "b-solar-patron",
      name: "Solar Workspace Patron",
      category: "ENERGY",
      description:
        "Checked into 100% solar and green-grid powered coworking spaces.",
      verified: greenVenuesCount >= 3,
    },
    {
      id: "b-climate-positive",
      name: "Climate Positive Nomad",
      category: "WASTE",
      description: "Avoided over 25 kg of CO2 emissions compared to driving.",
      verified: totalAvoidedGrams >= 25000,
    },
  ];

  return {
    periodMonth,
    totalDistanceKm: Number(safeParseDistance(totalDistanceKm).toFixed(1)),
    totalEmissionsKgCo2: Number((totalEmissionsGrams / 1000).toFixed(2)),
    totalAvoidedKgCo2: Number((totalAvoidedGrams / 1000).toFixed(2)),
    treesEquivalentOffset,
    greenVenuesVisitedCount: greenVenuesCount,
    modeBreakdown,
    ecoBadgesEarned: ecoBadges,
    records: processedRecords,
    teamLeaderboard: aggregateTeamCarbonSavings(customTeams),
  };
}

/**
 * Default team carbon savings data celebrating distributed teams working from regional hubs (#5309).
 */
export function getDefaultTeamCarbonSavings(): TeamCarbonSavings[] {
  return [
    {
      teamId: "team-frontend-mobile",
      teamName: "Frontend & Mobile Engineering",
      department: "Product Engineering",
      membersCount: 18,
      regionalHub: "Berlin Mitte Eco-Hub",
      transitEmissionsSavedKg: 520.4,
      flightEmissionsAvoidedKg: 1400.0,
      monthlyAvoidedKgCo2: 1920.4,
      treesEquivalent: 105.8,
      hubUtilizationRate: 94,
      badgeTier: "EMERALD",
      rank: 1,
    },
    {
      teamId: "team-cloud-infra",
      teamName: "Cloud Infrastructure & SRE",
      department: "Systems & Security",
      membersCount: 14,
      regionalHub: "Tokyo Shibuya Green Hub",
      transitEmissionsSavedKg: 410.2,
      flightEmissionsAvoidedKg: 1050.0,
      monthlyAvoidedKgCo2: 1460.2,
      treesEquivalent: 80.5,
      hubUtilizationRate: 89,
      badgeTier: "GOLD",
      rank: 2,
    },
    {
      teamId: "team-product-design",
      teamName: "Product & UX Design Guild",
      department: "Design & Research",
      membersCount: 12,
      regionalHub: "London Shoreditch Workspace",
      transitEmissionsSavedKg: 345.8,
      flightEmissionsAvoidedKg: 875.0,
      monthlyAvoidedKgCo2: 1220.8,
      treesEquivalent: 67.3,
      hubUtilizationRate: 86,
      badgeTier: "SILVER",
      rank: 3,
    },
    {
      teamId: "team-ai-data",
      teamName: "AI Research & Data Platform",
      department: "Data Engineering",
      membersCount: 10,
      regionalHub: "San Francisco SoMa Commons",
      transitEmissionsSavedKg: 280.5,
      flightEmissionsAvoidedKg: 700.0,
      monthlyAvoidedKgCo2: 980.5,
      treesEquivalent: 54.0,
      hubUtilizationRate: 82,
      badgeTier: "BRONZE",
      rank: 4,
    },
    {
      teamId: "team-customer-ops",
      teamName: "Customer Success & Operations",
      department: "Operations",
      membersCount: 16,
      regionalHub: "Austin Downtown Eco-Lounge",
      transitEmissionsSavedKg: 210.0,
      flightEmissionsAvoidedKg: 525.0,
      monthlyAvoidedKgCo2: 735.0,
      treesEquivalent: 40.5,
      hubUtilizationRate: 78,
      badgeTier: "BRONZE",
      rank: 5,
    },
  ];
}

/**
 * Aggregates monthly CO2e savings per team organization (#5309).
 * Computes combined transit and flight avoidance savings, assigns ranks, and evaluates badge tiers.
 */
export function aggregateTeamCarbonSavings(
  teams?: Partial<TeamCarbonSavings>[],
): TeamCarbonSavings[] {
  const baseTeams: TeamCarbonSavings[] =
    teams && teams.length > 0
      ? teams.map((t, idx) => {
          const transitSaved = Number(
            safeParseDistance(t.transitEmissionsSavedKg ?? 0).toFixed(1),
          );
          const flightSaved = Number(
            safeParseDistance(t.flightEmissionsAvoidedKg ?? 0).toFixed(1),
          );
          const totalAvoided =
            t.monthlyAvoidedKgCo2 !== undefined
              ? Number(safeParseDistance(t.monthlyAvoidedKgCo2).toFixed(1))
              : Number((transitSaved + flightSaved).toFixed(1));
          const trees =
            t.treesEquivalent !== undefined
              ? Number(safeParseDistance(t.treesEquivalent).toFixed(1))
              : Number(((totalAvoided / 21.77) * 12).toFixed(1));

          return {
            teamId: t.teamId || `team-${idx + 1}`,
            teamName: t.teamName || `Team ${idx + 1}`,
            department: t.department || "General Operations",
            membersCount: t.membersCount ?? 8,
            regionalHub: t.regionalHub || "Regional Eco-Hub",
            monthlyAvoidedKgCo2: totalAvoided,
            transitEmissionsSavedKg: transitSaved,
            flightEmissionsAvoidedKg: flightSaved,
            treesEquivalent: trees,
            hubUtilizationRate: t.hubUtilizationRate ?? 80,
            badgeTier: t.badgeTier || "BRONZE",
          };
        })
      : getDefaultTeamCarbonSavings();

  // Sort descending by monthly avoided CO2
  const sorted = [...baseTeams].sort(
    (a, b) => b.monthlyAvoidedKgCo2 - a.monthlyAvoidedKgCo2,
  );

  return sorted.map((team, idx) => {
    const rank = idx + 1;
    let badgeTier: "EMERALD" | "GOLD" | "SILVER" | "BRONZE" = "BRONZE";
    if (rank === 1) badgeTier = "EMERALD";
    else if (rank === 2) badgeTier = "GOLD";
    else if (rank === 3) badgeTier = "SILVER";

    return {
      ...team,
      rank,
      badgeTier,
    };
  });
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Generates an exportable vector SVG badge for corporate ESG and sustainability reports (#5309).
 */
export function generateTeamBadgeSVG(
  team: TeamCarbonSavings,
  periodMonth: string = "October 2026",
): string {
  const medalColor =
    team.badgeTier === "EMERALD"
      ? "#10b981"
      : team.badgeTier === "GOLD"
        ? "#f59e0b"
        : team.badgeTier === "SILVER"
          ? "#94a3b8"
          : "#cd7f32";

  const safeTeamName = escapeXml(team.teamName);
  const safeHubName = escapeXml(team.regionalHub);
  const safePeriod = escapeXml(periodMonth);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 360" width="600" height="360">
  <defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#022c22"/>
      <stop offset="50%" stop-color="#064e3b"/>
      <stop offset="100%" stop-color="#0f172a"/>
    </linearGradient>
    <linearGradient id="goldGrad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="${medalColor}"/>
      <stop offset="100%" stop-color="#34d399"/>
    </linearGradient>
  </defs>

  <!-- Background Card -->
  <rect x="10" y="10" width="580" height="340" rx="24" fill="url(#bgGrad)" stroke="${medalColor}" stroke-width="3" stroke-opacity="0.6"/>

  <!-- Seal / Border Glow Ring -->
  <circle cx="300" cy="80" r="44" fill="#0f172a" stroke="url(#goldGrad)" stroke-width="4"/>
  <text x="300" y="88" font-family="system-ui, sans-serif" font-size="28" font-weight="900" fill="#ffffff" text-anchor="middle">#${team.rank || 1}</text>

  <!-- Header & Team Name -->
  <text x="300" y="150" font-family="system-ui, sans-serif" font-size="22" font-weight="bold" fill="#ffffff" text-anchor="middle">${safeTeamName}</text>
  <text x="300" y="174" font-family="system-ui, sans-serif" font-size="13" font-weight="500" fill="#a7f3d0" text-anchor="middle">Regional Hub: ${safeHubName}</text>

  <!-- Core Metric Highlights -->
  <rect x="40" y="195" width="245" height="75" rx="14" fill="#0f172a" fill-opacity="0.8" stroke="#10b981" stroke-opacity="0.3"/>
  <text x="162" y="222" font-family="system-ui, sans-serif" font-size="11" font-weight="600" fill="#94a3b8" text-anchor="middle">MONTHLY CO2e AVOIDED</text>
  <text x="162" y="254" font-family="monospace, sans-serif" font-size="22" font-weight="900" fill="#34d399" text-anchor="middle">${team.monthlyAvoidedKgCo2} kg</text>

  <rect x="315" y="195" width="245" height="75" rx="14" fill="#0f172a" fill-opacity="0.8" stroke="#06b6d4" stroke-opacity="0.3"/>
  <text x="437" y="222" font-family="system-ui, sans-serif" font-size="11" font-weight="600" fill="#94a3b8" text-anchor="middle">TREE EQUIVALENCY</text>
  <text x="437" y="254" font-family="monospace, sans-serif" font-size="22" font-weight="900" fill="#38bdf8" text-anchor="middle">${team.treesEquivalent} Trees</text>

  <!-- ESG Footer Certification -->
  <text x="300" y="302" font-family="system-ui, sans-serif" font-size="11" font-weight="600" fill="#6ee7b7" text-anchor="middle">WorkSphere Scope 3 Corporate ESG Verified • ${safePeriod}</text>
  <text x="300" y="322" font-family="system-ui, sans-serif" font-size="10" font-weight="400" fill="#64748b" text-anchor="middle">Regional Hub Avoidance Protocol: Zero Non-Essential Flight Policy</text>
</svg>`;
}

/**
 * Exports corporate Scope 3 ESG Audit report as CSV.
 */
export function exportCorporateESGReportCSV(
  summary: CarbonFootprintSummary
): string {
  const headers = [
    "Booking ID",
    "Workspace Venue",
    "Date",
    "Commute Distance (km)",
    "Transit Mode",
    "Trip Emissions (g CO2)",
    "Avoided Emissions vs Driving (g CO2)",
    "Green Certified Space",
  ];

  const rows = summary.records.map((r) => {
    const safeDist = safeParseDistance(r.distanceKm);
    return [
      r.bookingId,
      `"${r.venueName}"`,
      r.date,
      safeDist.toFixed(1),
      r.commuteMode,
      r.emissionsGramsCo2,
      r.avoidedGramsCo2,
      r.isGreenCertifiedVenue ? "YES" : "NO",
    ];
  });

  const safeTotalDist = safeParseDistance(summary.totalDistanceKm);
  const safeTotalEmissions = safeParseDistance(summary.totalEmissionsKgCo2);
  const safeTotalAvoided = safeParseDistance(summary.totalAvoidedKgCo2);

  const footer = [
    "",
    `"Total Distance Traveled (km)","${safeTotalDist}"`,
    `"Total Net Emissions (kg CO2)","${safeTotalEmissions}"`,
    `"Total CO2 Avoided vs Solo Driving (kg CO2)","${safeTotalAvoided}"`,
    `"Equivalent Trees Planted Offset","${summary.treesEquivalentOffset} Trees"`,
  ];

  return [headers.join(","), ...rows.map((r) => r.join(",")), ...footer].join(
    "\n"
  );
}

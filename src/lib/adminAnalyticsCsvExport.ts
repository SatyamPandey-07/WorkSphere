/**
 * adminAnalyticsCsvExport.ts
 *
 * Client-side structured CSV export for workspace analytics data.
 */

export interface AnalyticsExportData {
  range: string;
  generatedAt: string;
  overview: {
    activeUsers: number;
    totalUsers: number;
    searches: number;
    bookings: number;
    averageResolutionMs: number;
    agentSuccessRate: number;
  };
  searchTerms: Array<{ term: string; count: number }>;
  amenities: Array<{ amenity: string; count: number }>;
  venueLeaderboard: Array<{
    id: string;
    name: string;
    category: string;
    views: number;
    bookings: number;
    rating: number;
    score: number;
  }>;
  bookingTrend: Array<{ date: string; bookings: number }>;
  ratingTrend: Array<{ date: string; rating: number | null }>;
}

export function generateAnalyticsCSV(data: AnalyticsExportData): string {
  const lines: string[] = [];

  // Section 1: Overview Summary
  lines.push("=== WORKSPACE ANALYTICS OVERVIEW ===");
  lines.push(`Time Window,${data.range}`);
  lines.push(`Generated At,${data.generatedAt}`);
  lines.push(`Active Users,${data.overview.activeUsers}`);
  lines.push(`Total Accounts,${data.overview.totalUsers}`);
  lines.push(`Search Queries,${data.overview.searches}`);
  lines.push(`Total Bookings,${data.overview.bookings}`);
  lines.push(`Avg Agent Latency (ms),${data.overview.averageResolutionMs}`);
  lines.push(`Agent Success Rate (%),${data.overview.agentSuccessRate}`);
  lines.push("");

  // Section 2: Venue Leaderboard
  lines.push("=== VENUE POPULARITY LEADERBOARD ===");
  lines.push("Rank,Venue ID,Venue Name,Category,Views,Bookings,Rating,Score");
  data.venueLeaderboard.forEach((v, index) => {
    const cleanName = `"${v.name.replace(/"/g, '""')}"`;
    const ratingStr =
      v.rating != null && !isNaN(v.rating) ? v.rating.toFixed(1) : "0.0";
    lines.push(
      `${index + 1},${v.id},${cleanName},${v.category},${v.views},${v.bookings},${ratingStr},${v.score}`,
    );
  });
  lines.push("");

  // Section 3: Daily Trends & Check-ins
  lines.push("=== DAILY BOOKINGS & RATING TRENDS ===");
  lines.push("Date,Bookings,Average Rating");
  const trendDates = Array.from(
    new Set([
      ...data.bookingTrend.map((b) => b.date),
      ...data.ratingTrend.map((r) => r.date),
    ]),
  ).sort();

  trendDates.forEach((date) => {
    const bMatch = data.bookingTrend.find((b) => b.date === date);
    const rMatch = data.ratingTrend.find((r) => r.date === date);
    const bookings = bMatch ? bMatch.bookings : 0;
    const rating =
      rMatch && rMatch.rating != null ? rMatch.rating.toFixed(1) : "N/A";
    lines.push(`${date},${bookings},${rating}`);
  });
  lines.push("");

  // Section 4: Requested Amenities
  lines.push("=== REQUESTED AMENITIES ===");
  lines.push("Amenity,Count");
  data.amenities.forEach((a) => {
    lines.push(`"${a.amenity}",${a.count}`);
  });
  lines.push("");

  // Section 5: Top Search Terms
  lines.push("=== TOP SEARCH TERMS ===");
  lines.push("Search Term,Count");
  data.searchTerms.forEach((s) => {
    lines.push(`"${s.term.replace(/"/g, '""')}",${s.count}`);
  });

  return lines.join("\n");
}

export function downloadAnalyticsCSV(data: AnalyticsExportData): Blob {
  const csvText = generateAnalyticsCSV(data);
  const blob = new Blob([csvText], { type: "text/csv;charset=utf-8;" });

  if (typeof window !== "undefined" && typeof document !== "undefined") {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    const dateStr = new Date(data.generatedAt).toISOString().slice(0, 10);
    anchor.download = `workspace-analytics-${data.range}-${dateStr}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }

  return blob;
}

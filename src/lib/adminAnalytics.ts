import { prisma } from "@/lib/prisma";
import { getAnalyticsSummaryAsync } from "@/lib/analytics";

type AnalyticsEvent = {
  name: string;
  properties?: Record<string, unknown>;
  timestamp: number;
};

export type RangeKey = "7d" | "30d" | "90d";

export const RANGE_DAYS: Record<RangeKey, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "at",
  "for",
  "from",
  "in",
  "is",
  "me",
  "my",
  "near",
  "of",
  "on",
  "or",
  "the",
  "to",
  "with",
  "workspace",
  "place",
  "find",
  "show",
  "looking",
  "want",
  "need",
]);

export function startDateForRange(range: RangeKey) {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - (RANGE_DAYS[range] - 1));
  return start;
}

export function isoDay(value: Date | number) {
  return new Date(value).toISOString().slice(0, 10);
}

export function createDaySeries(start: Date) {
  const result: Record<string, number> = {};
  const cursor = new Date(start);
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  while (cursor <= today) {
    result[isoDay(cursor)] = 0;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return result;
}

function extractSearchTerms(events: AnalyticsEvent[]) {
  const counts = new Map<string, number>();

  for (const event of events) {
    if (event.name !== "search_performed") continue;

    const query =
      typeof event.properties?.query === "string"
        ? event.properties.query.toLowerCase()
        : "";

    for (const token of query.match(/[a-z0-9-]{3,}/g) ?? []) {
      if (STOP_WORDS.has(token)) continue;
      counts.set(token, (counts.get(token) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .map(([term, count]) => ({ term, count }))
    .sort((a, b) => b.count - a.count || a.term.localeCompare(b.term))
    .slice(0, 30);
}

function extractAmenities(events: AnalyticsEvent[]) {
  const counts = new Map<string, number>();

  for (const event of events) {
    if (event.name !== "search_performed" && event.name !== "filter_applied") {
      continue;
    }

    const filters = event.properties?.filters;

    if (Array.isArray(filters)) {
      for (const key of filters) {
        if (typeof key === "string") {
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
      }
      continue;
    }

    if (filters && typeof filters === "object") {
      for (const [key, value] of Object.entries(filters)) {
        if (
          value !== false &&
          value !== null &&
          value !== undefined &&
          value !== ""
        ) {
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
      }
    }
  }

  return [...counts.entries()]
    .map(([amenity, count]) => ({ amenity, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);
}

function average(values: number[]) {
  if (values.length === 0) return 0;
  return Math.round(
    values.reduce((sum, value) => sum + value, 0) / values.length,
  );
}

export async function getAdminAnalytics(range: RangeKey) {
  const startDate = startDateForRange(range);

  // 1. Fetch initial statistics and telemetry
  const [telemetry, totalUsers] = await Promise.all([
    getAnalyticsSummaryAsync(),
    prisma.user.count(),
  ]);

  const recentEvents = (telemetry.recentEvents as AnalyticsEvent[]).filter(
    (event) => event.timestamp >= startDate.getTime(),
  );

  // 2. Perform DB-level counts/groups for telemetry views, bookings, and ratings
  const venueViews = new Map<string, number>();
  for (const event of recentEvents) {
    if (event.name !== "venue_viewed") continue;
    const venueId = event.properties?.venueId;
    if (typeof venueId === "string") {
      venueViews.set(venueId, (venueViews.get(venueId) ?? 0) + 1);
    }
  }

  const [
    bookingCounts,
    ratingStats,
    bookingTrendData,
    ratingTrendData,
    activeConversationsCount,
    totalBookingsCount,
  ] = await Promise.all([
    prisma.booking.groupBy({
      by: ["venueId"],
      where: {
        createdAt: { gte: startDate },
        status: { not: "CANCELLED" },
      },
      _count: {
        _all: true,
      },
    }),
    prisma.venueRating.groupBy({
      by: ["venueId"],
      where: { createdAt: { gte: startDate } },
      _avg: {
        wifiQuality: true,
      },
    }),
    prisma.booking.findMany({
      where: { createdAt: { gte: startDate } },
      select: { createdAt: true },
    }),
    prisma.venueRating.findMany({
      where: { createdAt: { gte: startDate } },
      select: {
        createdAt: true,
        wifiQuality: true,
      },
    }),
    prisma.conversation.findMany({
      where: { updatedAt: { gte: startDate } },
      distinct: ["userId"],
      select: { userId: true },
    }),
    prisma.booking.count({
      where: {
        createdAt: { gte: startDate },
        status: { not: "CANCELLED" },
      },
    }),
  ]);

  // 3. Find the set of all active venue IDs in this range
  const activeVenueIds = new Set<string>([
    ...venueViews.keys(),
    ...bookingCounts.map((b) => b.venueId),
    ...ratingStats.map((r) => r.venueId),
  ]);

  // 4. Fetch only the active venues (plus top-rated inactive venues if active count is < 10)
  let leaderboardVenues = await prisma.venue.findMany({
    where: { id: { in: Array.from(activeVenueIds) } },
    select: {
      id: true,
      name: true,
      category: true,
      rating: true,
    },
  });

  if (leaderboardVenues.length < 10) {
    const remainingCount = 10 - leaderboardVenues.length;
    const additionalVenues = await prisma.venue.findMany({
      where: { id: { notIn: Array.from(activeVenueIds) } },
      orderBy: { rating: "desc" },
      take: remainingCount,
      select: {
        id: true,
        name: true,
        category: true,
        rating: true,
      },
    });
    leaderboardVenues = [...leaderboardVenues, ...additionalVenues];
  }

  // 5. Populate venue stats
  const venueStats = new Map<
    string,
    { views: number; bookings: number; ratingAvg: number | null }
  >();

  for (const venue of leaderboardVenues) {
    venueStats.set(venue.id, {
      views: 0,
      bookings: 0,
      ratingAvg: null,
    });
  }

  for (const [venueId, views] of venueViews.entries()) {
    const stat = venueStats.get(venueId);
    if (stat) stat.views = views;
  }

  for (const booking of bookingCounts) {
    const stat = venueStats.get(booking.venueId);
    if (stat) stat.bookings = booking._count._all;
  }

  for (const rating of ratingStats) {
    const stat = venueStats.get(rating.venueId);
    if (stat) stat.ratingAvg = rating._avg.wifiQuality;
  }

  const venueLeaderboard = leaderboardVenues
    .map((venue) => {
      const stat = venueStats.get(venue.id)!;
      const averageRating =
        stat.ratingAvg !== null
          ? Number(stat.ratingAvg.toFixed(1))
          : (venue.rating ?? 0);

      const score = stat.views * 1 + stat.bookings * 4 + averageRating * 2;

      return {
        id: venue.id,
        name: venue.name,
        category: venue.category,
        views: stat.views,
        bookings: stat.bookings,
        rating: averageRating,
        score: Number(score.toFixed(1)),
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);

  // 6. Build booking and rating daily trend series
  const bookingByDay = createDaySeries(startDate);
  for (const booking of bookingTrendData) {
    const day = isoDay(booking.createdAt);
    if (day in bookingByDay) bookingByDay[day] += 1;
  }

  const ratingByDay = new Map<string, { total: number; count: number }>();
  for (const rating of ratingTrendData) {
    const day = isoDay(rating.createdAt);
    const current = ratingByDay.get(day) ?? { total: 0, count: 0 };
    current.total += rating.wifiQuality;
    current.count += 1;
    ratingByDay.set(day, current);
  }

  const agentDurations = recentEvents
    .filter((event) => event.name === "agent_completed")
    .map((event) => Number(event.properties?.durationMs))
    .filter(Number.isFinite);

  const successfulAgentRuns = recentEvents.filter(
    (event) =>
      event.name === "agent_completed" && event.properties?.success === true,
  ).length;

  const agentRuns = recentEvents.filter(
    (event) => event.name === "agent_completed",
  ).length;

  const searchCount = recentEvents.filter(
    (event) => event.name === "search_performed",
  ).length;

  return {
    range,
    generatedAt: new Date().toISOString(),
    overview: {
      activeUsers: activeConversationsCount.length,
      totalUsers,
      searches: searchCount,
      bookings: totalBookingsCount,
      averageResolutionMs: average(agentDurations),
      agentSuccessRate:
        agentRuns > 0
          ? Number(((successfulAgentRuns / agentRuns) * 100).toFixed(1))
          : 0,
    },
    searchTerms: extractSearchTerms(recentEvents),
    amenities: extractAmenities(recentEvents),
    venueLeaderboard,
    bookingTrend: Object.entries(bookingByDay).map(([date, bookings]) => ({
      date,
      bookings,
    })),
    ratingTrend: Object.entries(createDaySeries(startDate)).map(([date]) => {
      const current = ratingByDay.get(date);
      return {
        date,
        rating:
          current && current.count > 0
            ? Number((current.total / current.count).toFixed(2))
            : null,
      };
    }),
    eventCounts: telemetry.eventCounts,
  };
}

export function parseAnalyticsRange(value: string | null): RangeKey {
  return value === "7d" || value === "90d" ? value : "30d";
}

import { prisma } from "@/lib/prisma";
import { getAnalyticsSummaryAsync } from "@/lib/analytics";

type AnalyticsEvent = {
  name: string;
  properties?: Record<string, unknown>;
  timestamp: number;
};

type RangeKey = "7d" | "30d" | "90d";

const RANGE_DAYS: Record<RangeKey, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

const STOP_WORDS = new Set([
  "a", "an", "and", "at", "for", "from", "in", "is", "me", "my",
  "near", "of", "on", "or", "the", "to", "with", "workspace", "place",
  "find", "show", "looking", "want", "need",
]);

function startDateForRange(range: RangeKey) {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - (RANGE_DAYS[range] - 1));
  return start;
}

function isoDay(value: Date | number) {
  return new Date(value).toISOString().slice(0, 10);
}

function createDaySeries(start: Date) {
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
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

export async function getAdminAnalytics(range: RangeKey) {
  const startDate = startDateForRange(range);

  const [
    telemetry,
    bookings,
    ratings,
    venues,
    activeConversations,
    totalUsers,
  ] = await Promise.all([
    getAnalyticsSummaryAsync(),
    prisma.booking.findMany({
      where: { createdAt: { gte: startDate } },
      select: {
        venueId: true,
        createdAt: true,
        status: true,
        date: true,
        time: true,
      },
    }),
    prisma.venueRating.findMany({
      where: { createdAt: { gte: startDate } },
      select: {
        venueId: true,
        wifiQuality: true,
        createdAt: true,
      },
    }),
    prisma.venue.findMany({
      select: {
        id: true,
        name: true,
        category: true,
        rating: true,
      },
    }),
    prisma.conversation.findMany({
      where: { updatedAt: { gte: startDate } },
      select: { userId: true },
    }),
    prisma.user.count(),
  ]);

  const recentEvents = (telemetry.recentEvents as AnalyticsEvent[]).filter(
    (event) => event.timestamp >= startDate.getTime(),
  );

  const bookingByDay = createDaySeries(startDate);
  for (const booking of bookings) {
    const day = isoDay(booking.createdAt);
    if (day in bookingByDay) bookingByDay[day] += 1;
  }

  const ratingByDay = new Map<string, { total: number; count: number }>();
  for (const rating of ratings) {
    const day = isoDay(rating.createdAt);
    const current = ratingByDay.get(day) ?? { total: 0, count: 0 };
    current.total += rating.wifiQuality;
    current.count += 1;
    ratingByDay.set(day, current);
  }

  const venueStats = new Map<
    string,
    { views: number; bookings: number; ratingTotal: number; ratingCount: number }
  >();

  for (const venue of venues) {
    venueStats.set(venue.id, {
      views: 0,
      bookings: 0,
      ratingTotal: 0,
      ratingCount: 0,
    });
  }

  for (const event of recentEvents) {
    if (event.name !== "venue_viewed") continue;
    const venueId = event.properties?.venueId;
    if (typeof venueId !== "string") continue;
    const stat = venueStats.get(venueId);
    if (stat) stat.views += 1;
  }

  for (const booking of bookings) {
    const stat = venueStats.get(booking.venueId);
    if (stat && booking.status !== "CANCELLED") stat.bookings += 1;
  }

  for (const rating of ratings) {
    const stat = venueStats.get(rating.venueId);
    if (stat) {
      stat.ratingTotal += rating.wifiQuality;
      stat.ratingCount += 1;
    }
  }

  const venueLeaderboard = venues
    .map((venue) => {
      const stat = venueStats.get(venue.id)!;
      const averageRating =
        stat.ratingCount > 0
          ? Number((stat.ratingTotal / stat.ratingCount).toFixed(1))
          : venue.rating ?? 0;

      const score =
        stat.views * 1 +
        stat.bookings * 4 +
        averageRating * 2;

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

  const agentDurations = recentEvents
    .filter((event) => event.name === "agent_completed")
    .map((event) => Number(event.properties?.durationMs))
    .filter(Number.isFinite);

  const successfulAgentRuns = recentEvents.filter(
    (event) =>
      event.name === "agent_completed" &&
      event.properties?.success === true,
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
      activeUsers: new Set(activeConversations.map((item) => item.userId)).size,
      totalUsers,
      searches: searchCount,
      bookings: bookings.filter((booking) => booking.status !== "CANCELLED").length,
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

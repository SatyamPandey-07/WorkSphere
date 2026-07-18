import { prisma } from "@/lib/prisma";
import { getAnalyticsSummaryAsync } from "@/lib/analytics";
import { getDbLatencyStats } from "@/lib/dbTelemetry";
import {
  createDaySeries,
  isoDay,
  startDateForRange,
  type RangeKey,
} from "@/lib/adminAnalytics";

type AnalyticsEvent = {
  name: string;
  properties?: Record<string, unknown>;
  timestamp: number;
};

function average(values: number[]) {
  if (values.length === 0) return 0;
  return Math.round(
    values.reduce((sum, value) => sum + value, 0) / values.length,
  );
}

function percentile(sortedValues: number[], p: number) {
  if (sortedValues.length === 0) return 0;
  const index = Math.min(
    sortedValues.length - 1,
    Math.floor((p / 100) * sortedValues.length),
  );
  return sortedValues[index];
}

export async function getAdminSystemMetrics(range: RangeKey) {
  const startDate = startDateForRange(range);

  const [telemetry, reviews, dbLatency] = await Promise.all([
    getAnalyticsSummaryAsync(),
    prisma.venueRating.findMany({
      where: { createdAt: { gte: startDate } },
      select: { createdAt: true },
    }),
    getDbLatencyStats(),
  ]);

  const recentEvents = (telemetry.recentEvents as AnalyticsEvent[]).filter(
    (event) => event.timestamp >= startDate.getTime(),
  );

  const searchByDay = createDaySeries(startDate);
  const venueClicksByDay = createDaySeries(startDate);
  const reviewsByDay = createDaySeries(startDate);

  for (const event of recentEvents) {
    const day = isoDay(event.timestamp);
    if (event.name === "search_performed" && day in searchByDay) {
      searchByDay[day] += 1;
    }
    if (event.name === "venue_viewed" && day in venueClicksByDay) {
      venueClicksByDay[day] += 1;
    }
  }

  for (const review of reviews) {
    const day = isoDay(review.createdAt);
    if (day in reviewsByDay) reviewsByDay[day] += 1;
  }

  const usageTrend = Object.keys(searchByDay).map((date) => ({
    date,
    searches: searchByDay[date],
    venueClicks: venueClicksByDay[date],
    reviews: reviewsByDay[date],
  }));

  const agentEvents = recentEvents.filter(
    (event) => event.name === "agent_completed",
  );

  const agentDurationsByDay = new Map<string, number[]>();
  for (const event of agentEvents) {
    const day = isoDay(event.timestamp);
    const duration = Number(event.properties?.durationMs);
    if (!Number.isFinite(duration)) continue;

    const bucket = agentDurationsByDay.get(day) ?? [];
    bucket.push(duration);
    agentDurationsByDay.set(day, bucket);
  }

  const agentLatencyTrend = Object.keys(searchByDay).map((date) => {
    const durations = (agentDurationsByDay.get(date) ?? []).sort(
      (a, b) => a - b,
    );
    return {
      date,
      avgMs: average(durations),
      p95Ms: Math.round(percentile(durations, 95)),
      runs: durations.length,
    };
  });

  const allAgentDurations = agentEvents
    .map((event) => Number(event.properties?.durationMs))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);

  const agentByName = new Map<string, number[]>();
  for (const event of agentEvents) {
    const name = String(event.properties?.agent ?? "unknown");
    const duration = Number(event.properties?.durationMs);
    if (!Number.isFinite(duration)) continue;
    const bucket = agentByName.get(name) ?? [];
    bucket.push(duration);
    agentByName.set(name, bucket);
  }

  const agentBreakdown = [...agentByName.entries()]
    .map(([agent, durations]) => {
      const sorted = [...durations].sort((a, b) => a - b);
      return {
        agent,
        avgMs: average(sorted),
        p95Ms: Math.round(percentile(sorted, 95)),
        runs: sorted.length,
      };
    })
    .sort((a, b) => b.runs - a.runs);

  return {
    range,
    generatedAt: new Date().toISOString(),
    usageTrend,
    overview: {
      totalSearches: Object.values(searchByDay).reduce((a, b) => a + b, 0),
      totalVenueClicks: Object.values(venueClicksByDay).reduce(
        (a, b) => a + b,
        0,
      ),
      totalReviews: Object.values(reviewsByDay).reduce((a, b) => a + b, 0),
      agentAvgMs: average(allAgentDurations),
      agentP95Ms: Math.round(percentile(allAgentDurations, 95)),
    },
    agentLatencyTrend,
    agentBreakdown,
    dbLatency,
  };
}

export function parseSystemRange(value: string | null): RangeKey {
  return value === "7d" || value === "90d" ? value : "30d";
}
